// export SRTM for HydroBASIN

var aoi_features = null

//var accuracy = 500 // m
var buffer_size = 2000

var accuracy = 30 // m
//var buffer_size = 0

var smoothen = false
var burn_water = false
var min_water_percentile = 25; // percentile to use for water (compute using all Landsat8 images)
var max_water_percentile = 50;

var ndwi_threshold = 0
var mndwi_threshold = 0
var ndvi_threshold = 0

var dem_min=0
var dem_max=1500
var colors_dem = ['006837', '1a9850', '66bd63', 'a6d96a', 'd9ef8b', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd73027', 'a50026', 'ffffff']

var prefix = 'SRTM_30_Asia_';

var azimuth = 90;
var zenith = 60;

function degrees(img) { return img.toFloat().multiply(180).divide(Math.PI); }

function radians(img) { return img.toFloat().multiply(Math.PI).divide(180); }

// DEM Hillshade function - Compute hillshade for the given illumination az, el.
function hillshade(az, ze, slope, aspect) {
  var azimuth = radians(ee.Image(az));
  var zenith = radians(ee.Image(ze));
  return azimuth.subtract(aspect).cos().multiply(slope.sin()).multiply(zenith.sin())
      .add(zenith.cos().multiply(slope.cos()));
}

function hillshadeit(image, elevation, weight) {
  var hsv  = image.unitScale(0, 255).rgbtohsv();

  var terrain = ee.call('Terrain', elevation);
  var slope = radians(terrain.select(['slope']));
  var aspect = radians(terrain.select(['aspect']));
  var hs = hillshade(azimuth, zenith, slope, aspect);

  var intensity = hs.multiply(weight).multiply(hsv.select('value'));
  var huesat = hsv.select('hue', 'saturation');
  
  return ee.Image.cat(huesat, intensity).hsvtorgb();
}

// adds vectors as rasters to map
var addToMapAsRaster = function(shapes, name, palette, width, opacity, filled, visible) {
  var outline = width;
  var img; 
  
  if (filled) {
    img = ee.Image().toByte();
    img = img.paint(shapes, 1); // paint fill
    img = img.paint(shapes, 0, outline + 1); // paint outline
  } else {
    img = ee.Image(0).mask(0);
    img = img.paint(shapes, 0, width);
  }

  var options = {
    palette: palette,
    max: 1,
    opacity: opacity
  };

  Map.addLayer(img, options, name, visible);

  return img;
}

/**
 * Sums all elements.
 * @return {number}
 */
var sumAll = function (a, start, end) {
    var sum = 0;
    for (var i = start; i < end; i++)
        sum += a[i];
    return sum;
};

function otsu(histogram) {
    var total = sumAll(histogram, 0, histogram.length);
    console.log(total)

    var sum = 0;
    for (var i = 1; i < histogram.length; ++i) {
        sum += i * histogram[i];
    }

    var sumB = 0;
    var wB = 0;
    var wF = 0;
    var mB;
    var mF;
    var max = 0.0;
    var between = 0.0;
    var threshold1 = 0.0;
    var threshold2 = 0.0;

    for (var j = 0; j < histogram.length; ++j) {
        wB += histogram[j];
        if (wB == 0)
            continue;

        wF = total - wB;
        if (wF == 0)
            break;
        sumB += j * histogram[j];
        mB = sumB / wB;
        mF = (sum - sumB) / wF;
        between = wB * wF * Math.pow(mB - mF, 2);
        if ( between >= max ) {
            threshold1 = j;
            if ( between > max ) {
                threshold2 = j;
            }
            max = between;            
        }
    }
    return ( threshold1 + threshold2 ) / 2.0;
}

// I(n+1, i, j) = I(n, i, j) + lambda * (cN * dN(I) + cS * dS(I) + cE * dE(I), cW * dW(I))
var peronaMalikFilter = function(I, iter, K, method) {
    var dxW = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 1, -1,  0],
                            [ 0,  0,  0]]);
  
  var dxE = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 0, -1,  1],
                            [ 0,  0,  0]]);
  
  var dyN = ee.Kernel.fixed(3, 3,
                           [[ 0,  1,  0],
                            [ 0, -1,  0],
                            [ 0,  0,  0]]);
  
  var dyS = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 0, -1,  0],
                            [ 0,  1,  0]]);

  var lambda = 0.2;

  if(method == 1) {
    var k1 = ee.Image(-1.0/K);

    for(var i = 0; i < iter; i++) {
      var dI_W = I.convolve(dxW)
      var dI_E = I.convolve(dxE)
      var dI_N = I.convolve(dyN)
      var dI_S = I.convolve(dyS)
      
      var cW = dI_W.multiply(dI_W).multiply(k1).exp();
      var cE = dI_E.multiply(dI_E).multiply(k1).exp();
      var cN = dI_N.multiply(dI_N).multiply(k1).exp();
      var cS = dI_S.multiply(dI_S).multiply(k1).exp();
  
      I = I.add(ee.Image(lambda).multiply(cN.multiply(dI_N).add(cS.multiply(dI_S)).add(cE.multiply(dI_E)).add(cW.multiply(dI_W))))
    }
  }
  else if(method == 2) {
    var k2 = ee.Image(K).multiply(ee.Image(K));

    for(var i = 0; i < iter; i++) {
      var dI_W = I.convolve(dxW)
      var dI_E = I.convolve(dxE)
      var dI_N = I.convolve(dyN)
      var dI_S = I.convolve(dyS)
      
      var cW = ee.Image(1.0).divide(ee.Image(1.0).add(dI_W.multiply(dI_W).divide(k2)));
      var cE = ee.Image(1.0).divide(ee.Image(1.0).add(dI_E.multiply(dI_E).divide(k2)));
      var cN = ee.Image(1.0).divide(ee.Image(1.0).add(dI_N.multiply(dI_N).divide(k2)));
      var cS = ee.Image(1.0).divide(ee.Image(1.0).add(dI_S.multiply(dI_S).divide(k2)));
  
      I = I.add(ee.Image(lambda).multiply(cN.multiply(dI_N).add(cS.multiply(dI_S)).add(cE.multiply(dI_E)).add(cW.multiply(dI_W))))
    }
  }
  
  return I;
}

var basins_au = [
  null, // 0
  null, // 1
  ee.FeatureCollection('ft:1Dq_Q2JvvYkYO-kFX7L4E4Nzycwc50j9hfhSsBQJW'), // 2
  ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp'), // 3
  ee.FeatureCollection('ft:1WZ4Utbbatdl3vFVK7kTmAyHDyRjhMVfXeJeJTnBa'), // 4
  ee.FeatureCollection('ft:1rrk-yEOb8ILSolV_kSVD1qGxszHcy0cSL9UnUxIh'), // 5
  ee.FeatureCollection('ft:1-aMEhsi4usdxVUSSjKkJGC8pir3duCi_5oItnxtT'), // 6
  ee.FeatureCollection('ft:1YDeXF2LN8gDeJAOJTX0Kwp9QwV_-ZFI2llKilTGu'), // 7
  ee.FeatureCollection('ft:1YQ1qpXis4Z9z0NvKLdz-FjxFP5q2_fABi6aNSFn0') // 8
];

var basins_sa = [
  null, // 0
  null, // 1               
  ee.FeatureCollection('ft:1jVWsPL91fcIoLyNXE0DNEGrJPclOwbD2MTrwP2ve'), // 2
  ee.FeatureCollection('ft:1lPvvAHlPQzuRtkTacFn3m7E0eBCn8kuiZOe2Liki'), // 3
  ee.FeatureCollection('ft:1Mn2m-jL9GAlOtgr3AcdSjto4PbJFr255tbbnKiv7'), // 4
  ee.FeatureCollection('ft:15BO9yk6N1eVROwd1vZpM8buGIqnd1mLEffWgJzXo'), // 5
  ee.FeatureCollection('ft:1bW8vRJNTTPQaH3PGnDCVUvSPV4i1Z_KGMhAqwcSa'), // 6
  ee.FeatureCollection('ft:') // 7
];

var basins_as = [
  null, // 0
  null, // 1
  null, // 2
  ee.FeatureCollection('ft:1lIZQ_UEVw5jSXa659pauQ-Vj2NrqPRDvZzy_Dclf'), // 3
  ee.FeatureCollection('ft:1PGBczjrAkg6npASSdst4q5OGRzURtuGpYrqCJL_m'), // 4
  ee.FeatureCollection('ft:1lSI44x9ljjhbWiK1e5ObGJofoYsBTg4JOzpPHL_9'), // 5
  ee.FeatureCollection('ft:1jAEPRKrvDB132gvzMdO1DGJX-pztNG6yAvy4fXzG'), // 6
  ee.FeatureCollection('ft:1axdkSHNYC6Fp0SZf7IgOeoXYHyEi6oEkCZrp_yy1'), // 7
  ee.FeatureCollection('ft:') // 8
];

// Flow Accumulation 15s (from: http://hydrosheds.cr.usgs.gov/datadownload.php?reqdata=15accb )
var flowacc15 = ee.Image('WWF/HydroSHEDS/15ACC');

// Style Map for Flow Accumulation                                
var style_flowacc = '\
<RasterSymbolizer>\
  <ColorMap  type="intervals" extended="false" >\
    <ColorMapEntry color="#0000ff" quantity="0" label="none" opacity="0"/>\
    <ColorMapEntry color="#00ff00" quantity="100" label="1-100" />\
    <ColorMapEntry color="#00BB66" quantity="10000" label="100-10k" />\
    <ColorMapEntry color="#0000ff" quantity="100000" label="10k-100k" />\
    <ColorMapEntry color="#ff00ff" quantity="1000000" label="100k-1M" />\
    <ColorMapEntry color="#ff0000" quantity="28000000" label="1M-28M" />\
  </ColorMap>\
</RasterSymbolizer>';

Map.addLayer(flowacc15, {'min': 1, 'max': 28000000}, ' - Flow Accumulation 15s data', false);
Map.addLayer(flowacc15.sldStyle(style_flowacc), {}, 'Flow Accumulation 15s Styled', false);
//Map.addLayer(flowacc15.mask(flowacc15.gt(10)).focal_max(450, 'square', 'meters'), {palette: ['000044'], opacity:0.6}, 'Flow Accumulation 15s > 10', true);


for(var i=5;i<=7;i++) {
  Map.addLayer(basins_au[i], {}, '*level ' + i, false)
  addToMapAsRaster(basins_au[i], 'level' + i, ['000000'], 2, 1, false, false)
}


// Murray & Darling
//var id = 5030073410; 
//var aoi_features = basins_au[3];

// Murray & Darling (basin near Cambera)
//var aoi_features = basins_au[5];
//var id = 5050597410;

// Murray & Darling (smaller basin near Cambera)
// var aoi_features = basins_au[7];
// var id = 5070596920;

// largerst basin of level 7
//var aoi_features = basins_au[7];
// var id = 5070087890;

//var aoi_features = basins_au[5];
//var id = 5050595240;

//var aoi_features = basins_au[8];
//var id = 5080596920;
//var id = 5080598860;
//var id = 5080598830;
//var id = 5080599330;
//var id = 5080599380;
//var id = 5080599390;


// ==================== Amazon
//var aoi_features = basins_sa[6];
//var id = 6060295570;
// var image_name = 'SRTM_90_Amazon_' + id;

var exportBasin = function(id) {
var aoi = aoi_features.filter(ee.Filter.eq('HYBAS_ID', id));
var not_aoi = aoi_features.filter(ee.Filter.neq('HYBAS_ID', id));

if(buffer_size !== 0 || accuracy > 450) {
  Map.addLayer(aoi, {}, 'aoi (original)');
  aoi = ee.FeatureCollection(ee.Feature(aoi.first()).simplify(accuracy).buffer(buffer_size, accuracy))
}

var aoiRegion = aoi.geometry(1e-2).bounds(1e-2).coordinates().getInfo()[0];

Map.centerObject(aoi, 10);  


var dem = ee.Image('USGS/SRTMGL1_003');
//var dem = ee.Image('CGIAR/SRTM90_V4').clip(aoi);
//var dem = ee.Image('WWF/HydroSHEDS/03CONDEM').clip(aoi);
// var dem = ee.Image('WWF/HydroSHEDS/03VFDEM').clip(aoi);

// aoi = dem.clip(aoi).mask().focal_max({radius:1000, units:'meters'})
//aoi = aoi.mask(aoi)
//Map.addLayer(aoi, {}, 'aoi (buffer)');
Map.addLayer(aoi, {}, 'aoi ');


var demVFP = ee.ImageCollection.fromImages([
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM1'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM2'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM3'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM4'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM5'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM6'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM7'),
  ee.Image('users/gena/ViewfinderpanoramaDEM/VFP_DEM8')
  ]).mosaic()
var mosaic = ee.ImageCollection.fromImages([demVFP.rename(['elevation']), dem]).mosaic();
dem = mosaic;


var style_dem = '\
<RasterSymbolizer>\
  <ColorMap  type="intervals" extended="false" >\
    <ColorMapEntry color="#cef2ff" quantity="-200" label="-200m"/>\
    <ColorMapEntry color="#9cd1a4" quantity="0" label="0m"/>\
    <ColorMapEntry color="#7fc089" quantity="50" label="50m" />\
    <ColorMapEntry color="#9cc78d" quantity="100" label="100m" />\
    <ColorMapEntry color="#b8cd95" quantity="250" label="250m" />\
    <ColorMapEntry color="#d0d8aa" quantity="500" label="500m" />\
    <ColorMapEntry color="#e1e5b4" quantity="750" label="750m" />\
    <ColorMapEntry color="#f1ecbf" quantity="1000" label="1000m" />\
    <ColorMapEntry color="#e2d7a2" quantity="1250" label="1250m" />\
    <ColorMapEntry color="#d1ba80" quantity="1500" label="1500m" />\
    <ColorMapEntry color="#d1ba80" quantity="10000" label="10000m" />\
  </ColorMap>\
</RasterSymbolizer>';

var v = dem.clip(aoi).visualize({palette:colors_dem, min:dem_min, max:dem_max, opacity: 1.0});
var v = dem.clip(aoi).sldStyle(style_dem);
Map.addLayer(hillshadeit(v, dem, 2.0, 2.0), {}, 'elevation');

Map.addLayer(dem.clip(aoi), {min: dem_min, max: dem_max}, 'dem', false);

var multiplier = 50.0;
if(smoothen) {
  dem = peronaMalikFilter(dem.multiply(1/multiplier), 20, 0.02, 2).multiply(multiplier)
}

Map.addLayer(dem.clip(aoi), {min: dem_min, max: dem_max}, 'dem (PM)', false);

var v = dem.clip(aoi).visualize({palette:colors_dem, min:dem_min, max:dem_max, opacity: 1.0});
Map.addLayer(hillshadeit(v, dem, 2.0, 2.0), {}, 'elevation (PM)', false);

// see http://en.wikipedia.org/wiki/World_file
var crs_transform = ee.Image('USGS/SRTMGL1_003').getInfo().bands[0].crs_transform;

var crs = dem.getInfo().bands[0].crs;

var w = Math.round((aoiRegion[1][0] - aoiRegion[0][0])/-crs_transform[4]);
var h = Math.round((aoiRegion[2][1] - aoiRegion[1][1])/crs_transform[0]);

// print(crs);
// print(crs_transform)


// crs_transform = [crs_transform[0], crs_transform[1], 0.0, crs_transform[3], crs_transform[4], 0.0];

// print(aoiRegion)

var dimensions = w + 'x' + h;
print(dimensions)

//print(dem)


// burn observerd L8 water using distance transform
var LC8_BANDS = ['B1', 'B2',   'B3',    'B4',  'B5',  'B6',    'B7',    'B8'];
var LC7_BANDS = ['B1', 'B1',   'B2',    'B3',  'B4',  'B5',    'B7',    'B8'];
var STD_NAMES = ['deepblue', 'blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'pan'];

// get all LANDSAT8 images
var images = ee.ImageCollection('LANDSAT/LC8_L1T_TOA')
  // .filterBounds(aoi)
  .filterBounds(Map.getBounds(true))
  .filterDate('2014-01-01', '2015-11-11')
  .select(LC8_BANDS, STD_NAMES);

var water_color = ['1010ff', '101050'];

var images_sng = images.select(['swir2', 'nir', 'green', 'pan', 'red', 'blue', 'swir1']);

var add_water = function(p) {
  var image_sng_max = images_sng.reduce(ee.Reducer.intervalMean(max_water_percentile, max_water_percentile+1));
  Map.addLayer(image_sng_max.clip(aoi), {gamma:1.5, min:0.05, max:0.5}, 'mean('+max_water_percentile+'%) SNG, max', false);

  var image_sng = images_sng.reduce(ee.Reducer.intervalMean(min_water_percentile, min_water_percentile+1));
  Map.addLayer(image_sng.clip(aoi), {gamma:1.5, min:0.05, max:0.5}, 'mean('+min_water_percentile+'%) SNG, min', false);
  
    //var image = images.reduce(ee.Reducer.intervalMean(p, p+1));
  //Map.addLayer(image, {}, 'image (percentile)', false)
  // Map.addLayer(image.clip(aoi).select(['red_mean','green_mean','blue_mean']), {gamma:2.0, min:[0.05,0.05,0.05], max:[0.3,0.3,0.7]}, 'mean('+p+'%)', false);
  
  //var ndwi_min=-0.15
  //var ndwi_max=0.15

var water_index_style = '\
<RasterSymbolizer>\
  <ColorMap extended="true" >\
    <ColorMapEntry color="#081dff" quantity="-1.0" label="-1"/>\
    <ColorMapEntry color="#081d58" quantity="-0.8" label="-1"/>\
    <ColorMapEntry color="#253494" quantity="-0.6" label="-1"/>\
    <ColorMapEntry color="#225ea8" quantity="-0.4" label="-1"/>\
    <ColorMapEntry color="#1d91c0" quantity="-0.2" label="-1"/>\
    <ColorMapEntry color="#41b6c4" quantity="0.0" label="-1"/>\
    <ColorMapEntry color="#7fcdbb" quantity="0.2" label="-1"/>\
    <ColorMapEntry color="#c7e9b4" quantity="0.4" label="-1"/>\
    <ColorMapEntry color="#edf8b1" quantity="0.6" label="-1"/>\
    <ColorMapEntry color="#ffffd9" quantity="1.0" label="-1"/>\
  </ColorMap>\
</RasterSymbolizer>';

  var water_index_vis = {min:-1, max:1};
  var water_vis = {min:0, max:1, palette: water_color, opacity:0.5};

  //var ndwi_min = image_sng.normalizedDifference(['nir_mean', 'green_mean']);
  var ndwi_min = image_sng.normalizedDifference(['swir1_mean', 'green_mean']);
  Map.addLayer(ndwi_min.clip(aoi), water_index_vis, 'ndwi('+min_water_percentile+'%), min', false);
  Map.addLayer(ndwi_min.sldStyle(water_index_style).clip(aoi), {}, 'ndwi('+min_water_percentile+'%), min (SLD)', false);
  
/*
  var ndvi_min = image_sng.normalizedDifference(['red_mean', 'nir_mean']);
  Map.addLayer(ndvi_min.clip(aoi), water_index_vis, 'ndvi('+min_water_percentile+'%), min', false);
  var mndwi_min = image_sng.normalizedDifference(['green_mean', 'swir1_mean']);
  Map.addLayer(mndwi_min.clip(aoi), water_index_vis, 'mndwi('+min_water_percentile+'%), min', false);

  var ndwi_max = image_sng.normalizedDifference(['green_mean', 'nir_mean']);
  Map.addLayer(ndwi_max.clip(aoi), water_index_vis, 'ndwi('+max_water_percentile+'%), max', false);
  var ndvi_max = image_sng.normalizedDifference(['red_mean', 'nir_mean']);
  Map.addLayer(ndvi_max.clip(aoi), water_index_vis, 'ndvi('+max_water_percentile+'%), max', false);
  var mndwi_max = image_sng.normalizedDifference(['green_mean', 'swir1_mean']);
  Map.addLayer(mndwi_max.clip(aoi), water_index_vis, 'mndwi('+max_water_percentile+'%), max', false);
*/
  var showHistograms = function() {
    var bounds = ee.Geometry(Map.getBounds(true));

    print(Chart.image.histogram(ndwi_min.clip(aoi), bounds, 90).setOptions({title: 'NDWI min'}));
    print(Chart.image.histogram(ndvi_min.clip(aoi), bounds, 90).setOptions({title: 'NDVI min'}));
    print(Chart.image.histogram(mndwi_min.clip(aoi), bounds, 90).setOptions({title: 'MNDWI min'}));
  }
  
/*  // potential water using 15sec flow accumulation    
  var potential_water = flowacc15.gt(100)

    //.focal_max(450, 'square', 'meters')
    .reduceToVectors({scale:450, geometry:aoi}).filter(ee.Filter.neq('label', 0))
  Map.addLayer(potential_water, {}, 'potential water')
  var flowacc_scale = flowacc15.getInfo().bands[0].crs_transform[0];

  print(Chart.image.histogram(flowacc15.clip(aoi), aoi, 450).setOptions({title: 'FLOWACC15s'}));
  
  print(Chart.image.histogram(ndwi_min.clip(potential_water), potential_water, 60).setOptions({title: 'NDWI min (clipped)'}));
  print(Chart.image.histogram(ndvi_min.clip(potential_water), potential_water, 60).setOptions({title: 'NDVI min (clipped)'}));
  print(Chart.image.histogram(mndwi_min.clip(potential_water), potential_water, 60).setOptions({title: 'MNDWI min (clipped)'}));

  var ndwi_potential_water = ndwi_min.clip(potential_water)
    .focal_max(60, 'square', 'meters');
    
  ndwi_potential_water = ndwi_potential_water.mask(ndwi_potential_water.gt(-0.2))

  //print(Chart.image.histogram(ndwi_potential_water, rivers_lines_osm, 30).setOptions({title: 'NDWI min (clipped)'}));
  
  // ndwi_potential_water = peronaMalikFilter(ndwi_potential_water, 35, 0.02, 2);
  
  var hsv = image_sng.select(['swir2_mean', 'nir_mean', 'green_mean']).clip(potential_water).rgbtohsv();
  var intensity = hsv.select('value')
    .lt(-0.113);
  var huesat = hsv.select('hue', 'saturation');
  Map.addLayer(ee.Image.cat(huesat, intensity).hsvtorgb());

  print(intensity)
  //print(Chart.image.histogram(intensity, potential_water, 30).setOptions({title: 'intensity'}));
  
  Map.addLayer(ndwi_potential_water, water_index_vis, 'ndwi('+min_water_percentile+'%), min', false);
  print(Chart.image.histogram(ndwi_potential_water, potential_water, 30).setOptions({title: 'NDWI min (clipped)'}));

  // compute threshold using Otsu method
  var ndwi_hist_info = ndwi_min.clip(potential_water).reduceRegion(ee.Reducer.histogram(255), potential_water, 30).getInfo()['nd'];
  var ndwi_hist = ndwi_hist_info['histogram']
  var threshold_index = otsu(ndwi_hist)
  ndwi_threshold = ndwi_hist_info['bucketMeans'][Math.round(threshold_index)];
  
  print("NDWI threshold: ", ndwi_threshold);
*/
  // showHistograms()

  //ndwi_min = peronaMalikFilter(ndwi_min, 20, 0.02, 2);

  var aoiSmaller = ee.FeatureCollection(ee.Feature(aoi.first()).buffer(-60, 500))

  var canny = ee.Algorithms.CannyEdgeDetector(ndwi_min.clip(aoi), 0.95, 1);
  canny = canny.mask(canny)
    //.reproject(crs, crs_transform)
    .clip(aoiSmaller)
  
  Map.addLayer(canny.mask(canny), {min: 0, max: 1, palette: 'FF0000'}, 'canny NDWI min', false);
  
  Map.addLayer(aoiSmaller, {}, 'aoi smaller', false)
  var ndwi_mask_canny = ndwi_min.clip(aoiSmaller).mask(canny.focal_max(30, "square", "meters"));
  
  Map.addLayer(ndwi_mask_canny, water_index_vis, "ndwi buffered canny", false)
  
  //var gaussianKernel = ee.Kernel.gaussian(60, 30, 'meters');
  print(Chart.image.histogram(ndwi_mask_canny, aoiSmaller, 30).setOptions({title: 'NDWI canny'}));
  
  // compute threshold using Otsu method
  var ndwi_hist_info = ndwi_mask_canny.reduceRegion(ee.Reducer.histogram(255), aoiSmaller, 30).getInfo()['nd'];
  var ndwi_hist = ndwi_hist_info['histogram']
  var threshold_index = otsu(ndwi_hist)
  ndwi_threshold = ndwi_hist_info['bucketMeans'][Math.round(threshold_index)];
  
  print("NDWI threshold: ", ndwi_threshold);

/*
var url = ndwi_potential_water.getDownloadURL({
    scale: 30,
    crs: crs,
    region: JSON.stringify(aoiRegion),
  });
  print(url)
*/
  

  // add NDWI < 0.0
  var water_min = ndwi_min.lt(ndwi_threshold);
  //Map.addLayer(ndwi_min.mask(water_min).clip(aoi), water_vis, 'ndwi('+min_water_percentile+'%) > ' + ndwi_threshold + ", min", false);
  
  var water_image_vis = {min:[0.03,0.03,0.03], max:[0.4,0.4,0.3], gamma:1.5};
  //Map.addLayer(image_sng.mask(water_min).clip(aoi), water_image_vis, 'mean('+min_water_percentile+'%) > ' + ndwi_threshold + " water, min");
  

  var canny = ee.Algorithms.CannyEdgeDetector(water_min, 0.99, 0.3);
  canny = canny.mask(canny).clip(aoiSmaller)

  // var water_max = ndwi_max.gt(ndwi_threshold);
  // Map.addLayer(ndwi_max.mask(water_max).clip(aoi), water_vis, 'ndwi('+min_water_percentile+'%) > ' + ndwi_threshold + ", max");

  var water = water_min;

/*  // Canny for ndwi
  var gaussianKernel = ee.Kernel.gaussian(60, 15, 'meters', true, 1);

  var ndwi_gauss = ndwi.convolve(gaussianKernel);

  var canny = ee.Algorithms.CannyEdgeDetector(ndwi_gauss, 0.2, 1);
  Map.addLayer(canny.mask(canny).clip(aoi), {min: 0, max: 1, palette: 'FF0000'}, 'Canny, ndwi('+p+'%)', false);
  var cannyVectors = canny
    .focal_max(30, 'circle', 'meters')
    .focal_min(30, 'circle', 'meters')
    .multiply(20).toInt().reduceToVectors({geometry:aoi, maxPixels:1e9, scale: 15})
    .filter(ee.Filter.neq('label', 0))

  Map.addLayer(cannyVectors, {palette: 'FF0000'}, 'Canny, poly, ndwi('+p+'%)', false);

  var waterVectors = water.reduceToVectors({geometry:aoi, maxPixels:1e9, scale:15})
    .filter(ee.Filter.neq('label', 0));
    
  Map.addLayer(waterVectors)

  var intersectSaveAll = ee.Join.saveAll({matchesKey: 'waterVectors', measureKey: 'distance'});
  var intersectsFilter = ee.Filter.intersects({leftField: '.geo', rightField: '.geo', maxError: 10});
  var intersectJoined = intersectSaveAll.apply(cannyVectors, waterVectors, intersectsFilter);

  Map.addLayer(intersectJoined, {palette: 'FF0000'}, 'Canny, poly, ndwi('+p+'%)', false);
*/
  // select large blobs using morphological closing
  var water_closed = water.focal_max(90, 'circle', 'meters').focal_min(90, 'circle', 'meters');
  water_closed = water_closed.mask(water_closed)
  Map.addLayer(water_closed.clip(aoi), {palette: water_color, opacity:0.5}, 'water_closing', false);

  var water_small = water.multiply(water_closed)
  Map.addLayer(water_small.clip(aoi), {palette: water_color, opacity:0.5}, 'water_small', false);

  // burn using distance transform
  var distance = water.not().distance(ee.Kernel.euclidean(1000, "meters"))
  Map.addLayer(distance.mask(water).clip(aoi), {min:0, max:1000}, 'distance(ndwi)', false);
  
  var burned = dem.add(distance.multiply(-0.1))
  Map.addLayer(burned.mask(water).clip(aoi), {min:dem_min, max:dem_max}, 'dem - distance(ndwi)', false);
  
  var v = burned.mask(water).visualize({palette:colors_dem, min:dem_min, max:dem_max, opacity: 1.0}).clip(aoi);
  Map.addLayer(hillshadeit(v, burned, 1.5), {}, 'burned', false);

  // add detected water layers  
  Map.addLayer(ndwi_min.mask(water_min).clip(aoi), water_vis, 'ndwi('+min_water_percentile+'%) > ' + ndwi_threshold + ", min", false);
  Map.addLayer(image_sng.mask(water_min).clip(aoi), water_image_vis, 'mean('+min_water_percentile+'%) > ' + ndwi_threshold + " water, min");

  Map.addLayer(canny, {palette:'aaaaff'}, 'water (boundary)')
  Map.addLayer(canny, {palette:'ffaaaa'}, 'water (boundary, red)', false)
  
  return burned;
}  
  
  
if(burn_water) {
  dem = add_water(20)
}

var maskAndFill = function(image, aoi) {
  var mask = ee.Image(0).byte().paint(aoi, 1);
  var fill = mask.not().multiply(-9999);

  var result = image.unmask().multiply(mask);
  result = result.add(fill);
  
  return result;
}

//var image = dem
var image = maskAndFill(dem, aoi);

/*
Export.image(image, image_name, 
{ 
  driveFileNamePrefix: image_name, 
  //format: 'tif', 
  crs: crs, 
  //crs_transform: JSON.stringify(crs_transform), 
  dimensions:dimensions, 
  region: aoiRegion,
  maxPixels:5e9
});
*/

var image_name = prefix + id.getInfo();
//var image_name = 'HYDROSHEDS_Asia_Andijan_' + id;

var file_name = image_name + '.zip';

print(file_name)

var url = image.getDownloadURL({
  name: image_name,
  //scale: 30,
  crs: crs,
  crs_transform: JSON.stringify(crs_transform),
  region: JSON.stringify(aoiRegion),
});
//print(url)

download(url, file_name)
validate_zip(file_name)
                                

}




/*


// get all LANDSAT8 images
var LC8_BANDS = ['B2',   'B3',    'B4',  'B5',  'B6',    'B7',    'B8', 'B10', 'BQA'];
var STD_NAMES = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'pan', 'temp', 'BQA'];
var MEAN_NAMES = ['blue_mean', 'green_mean', 'red_mean', 'nir_mean', 'swir1_mean', 'swir2_mean', 'pan_mean', 'temp_mean', 'BQA_mean'];
var image = ee.ImageCollection('LANDSAT/LC8_L1T_TOA').filterBounds(aoi)
  .select(LC8_BANDS, STD_NAMES)
  .reduce(ee.Reducer.intervalMean(35, 45))
  .select(MEAN_NAMES, STD_NAMES)
  .clip(aoi);

// Upscale XS to 4 times original resolution
var pan = image.select('pan');

var xs_crs = image.getInfo().bands[0].crs;
var xs_res = image.getInfo().bands[0].crs_transform[0];

// Upscale XS to 2 times original resolution
var p_crs = pan.getInfo().bands[0].crs;
var p_res = pan.getInfo().bands[0].crs_transform[0];

var upscale = function(image, pan) {
  var xs_upscale = image.reproject(xs_crs, null, xs_res/4);

  var p_upscale = pan.reproject(p_crs, null, p_res/2);

  var wght = 1.0/16.0;

  var meanKernel = ee.Kernel.fixed(4, 4,
                         [[wght, wght, wght, wght],
                          [wght, wght, wght, wght],
                          [wght, wght, wght, wght],
                          [wght, wght, wght, wght]]);

  var pconv = p_upscale.convolve(meanKernel);


// var wght = 1.0/4.0;
// var meanKernel = ee.Kernel.fixed(2, 2,
//                          [[wght, wght],
//                          [wght, wght]]);
//var xs_upscale = xs_upscale.convolve(meanKernel);

                          
  return xs_upscale.multiply(p_upscale.divide(pconv));
}

//var water = images_sng.map(upscale).reduce(ee.Reducer.intervalMean(p, p+1)).clip(aoi).normalizedDifference(['swir1_mean','green_mean']).gt(0);
Map.addLayer(upscale(dem, pan).clip(aoi), {min: 200, max: 2000}, 'dem (upscale)', false);
*/

/*var aoi_features = basins_au[5];
var basinsMurrayDarling = aoi_features
  .filter(ee.Filter.gte('PFAF_ID', 56400))
  .filter(ee.Filter.lte('PFAF_ID', 56499))
  .toList(count, 0);

exportBasin(5050597410)
*/
// exportBasin(5050595640) // large (19054x11026)


/*var aoi_features = basins_au[7];
var basinsMurrayDarling = aoi_features
  .filter(ee.Filter.and(ee.Filter.gte('PFAF_ID', 5640000), ee.Filter.lte('PFAF_ID', 5649999)))
  .toList(500, 0);
exportBasin(5070592020)
*/

/*
var aoi_features = basins_as[6];
var basinsMurrayDarling = aoi_features
  .filter(ee.Filter.eq('HYBAS_ID', 4060421200))
  .toList(1, 0);
  
exportBasin(4060421200)
*/


//exportBasin(5080596480)
//exportBasin(5080596920)

if(args[1] === 'list') { // download files given index file in args[2]
  var file = args[2]; // path to list of files to read
  prefix = args[3]; // file prefix
  var featureTable = args[4]; // FusionTable ID
  aoi_features = ee.FeatureCollection('ft:' + featureTable);
  print('Feature table:' + featureTable)
 
  var fs = require('fs')

  fs.readFile(file, 'utf8', function(err, data) {
    if (err) throw err;

    var lines = data.split('\n');
    for(var line = 0; line < lines.length; line++){
       if(lines[line].length > 1) {
          var id = parseInt(lines[line]);
          console.log('Downloading: ' + id + ' ...');
          exportBasin(ee.Number(id));
       }
    }
  });
} else {
  var startIndex = parseInt(args[1])
  var stopIndex = parseInt(args[2])
  var featureTable = args[3]
  prefix = args[4]

  aoi_features = ee.FeatureCollection('ft:' + featureTable);
  print('Feature table:' + featureTable)

  var count = aoi_features.aggregate_count('HYBAS_ID').getInfo()

  var offset = 0
  var catchments = aoi_features.toList(count, offset);

  var path = require('path');

  for(var i = startIndex; i < stopIndex; i++) {
    print('index: ' + i)
    var feature = ee.Feature(catchments.get(i))
    var id = feature.get('HYBAS_ID')
    print(id.getInfo())
    exportBasin(id)

    var idx_path = path.join(process.cwd(), 'download_SRTM.js.last');
    save(i + 1, idx_path)
  }
}