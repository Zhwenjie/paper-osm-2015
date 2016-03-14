/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var l8 = ee.ImageCollection("LANDSAT/LC8_L1T_TOA"),
    water_15 = ee.Image("users/gena/AU_Murray_Darling/MNDWI_15_water_WGS"),
    fa = ee.Image("users/gena/AU_Murray_Darling/SRTM_30_Murray_Darling_flow_accumulation");
/***** End of imports. If edited, may not auto-convert in the playground. *****/
// OSM_compute_buffers

var grid = ee.FeatureCollection('ft:1EI0slUr477ZKM3IWv-OOh0invsIXbUoaW9tixrzT')
var rivers_lines_osm = ee.FeatureCollection('ft:1nlWWjT4VkGjkp-kXKroFuyUuKDUSTqce_DDtmOt1')
var rivers_lines_osm_segments = ee.FeatureCollection('ft:1HbkaK1HfwdlaPB741WwUbltm-XN8aL-ro-UmwZYW')
var rivers_polygons_osm = ee.FeatureCollection('ft:1gUbHjPLpeC4Vzi59vE5JSFfLRDtcrngyWfSn8mQC');

var au_catchments_level3 = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
var aoi = au_catchments_level3
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));
    
var not_aoi = au_catchments_level3
    .filter(ee.Filter.neq('HYBAS_ID', 5030073410)); 

rivers_lines_osm = rivers_lines_osm
  .filter(ee.Filter.inList('waterway', ['river', 'stream', 'drain', 'canal', 'drain', 'creek', 'ditch']))

rivers_lines_osm_segments = rivers_lines_osm_segments
  .filter(ee.Filter.inList('waterway', ['river', 'stream', 'drain', 'canal', 'drain', 'creek', 'ditch']))

//Map.centerObject(grid, 10)

var dem = ee.Image('USGS/SRTMGL1_003');
var info = dem.getInfo() 
var crs = info.bands[0].crs
var crs_transform = info.bands[0].crs_transform
crs_transform = [crs_transform[0], crs_transform[1], 0.0, crs_transform[3], crs_transform[4], 0.0];

function getSimpleEdge(i, b) {
  var canny = ee.Algorithms.CannyEdgeDetector(i, 0.99, 0);
  canny = canny.mask(canny).clip(b)
  return canny;
}

// perform hit-or-miss
var hitOrMiss = function(image, se1, se2, crs, crs_transform) {
  if (typeof crs === 'undefined') { crs = null; }

  var e1 = image.reduceNeighborhood(ee.Reducer.min(), se1);
  var e2 = image.not().reduceNeighborhood(ee.Reducer.min(), se2);
  var result = e1.and(e2);
  
  if(crs !== null) {
    result = result.reproject(crs, crs_transform);
  }
  
  return result;
}

var crsTransformSetStep = function(step, t) {
  return [step, t[1], t[2], t[3], -step, t[5]];
}

var splitKernel = function(kernel, value) {
  var result = [];
  for(var r=0; r<kernel.length; r++) {
      
      var row = [];
      for(var c=0; c<kernel.length; c++) {
          row.push(kernel[r][c] == value ? 1 : 0);
      }
      result.push(row);
  }
  
  return result;
}

var skeletonize = function(image, iterations, method, crs, crs_transform) {
  if (typeof crs === 'undefined') { crs = null; }

  var se1w = [[2, 2, 2], 
              [0, 1, 0], 
              [1, 1, 1]];
  
  if(method == 2) {
    se1w = [[2, 2, 2], 
            [0, 1, 0], 
            [0, 1, 0]];
  }
  var se11 = ee.Kernel.fixed(3, 3, splitKernel(se1w, 1));
  var se12 = ee.Kernel.fixed(3, 3, splitKernel(se1w, 2));
  
  var se2w = [[2, 2, 0], 
              [2, 1, 1], 
              [0, 1, 0]];
  
  if(method == 2) {
       se2w = [[2, 2, 0], 
               [2, 1, 1], 
               [0, 1, 1]];
  }
  
  var se21 = ee.Kernel.fixed(3, 3, splitKernel(se2w, 1));
  var se22 = ee.Kernel.fixed(3, 3, splitKernel(se2w, 2));
  
  var result = image;
  
  if (crs !== null) {
    // ee.Image(0).or(image)
    
    //result = image.reproject(crs, crs_transform);
  }

  for(var i=0; i<iterations; i++) {
    for(var j=0; j<4; j++) { // rotate kernels
      result = result.subtract(hitOrMiss(result, se11, se12, crs, crs_transform));
      se11 = se11.rotate(1);
      se12 = se12.rotate(1);
  
      result = result.subtract(hitOrMiss(result, se21, se22, crs, crs_transform));
      se21 = se21.rotate(1);
      se22 = se22.rotate(1);

      //result = result.mask(mask);
    }
    
  
/*
if (i%5 === 0) {
      var color = 'fec4' + pad(parseInt(100.0 * i/iterations), 2);
      print(color)
      Map.addLayer(result.mask(result), {palette:color, opacity: 0.5}, 'thining' + i);
    }  
*/
  }
  
  return result;
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

addToMapAsRaster(au_catchments_level3, 'map (white)', 'ffffff', 0, 1, true, false);
addToMapAsRaster(au_catchments_level3, 'map (black)', '000000', 0, 1, true, true);

function computeScoresForRiverSegments() {
  // for every segment:
  
  // compute buffers
  
  // compute number of water pixels
}

var LC8_BANDS = ['B1',    'B2',   'B3',    'B4',  'B5',  'B6',    'B7',    'B8', 'B10', 'BQA'];
var STD_NAMES = ['blue2', 'blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'pan', 'temp', 'BQA'];
 
l8 = l8
  .filterBounds(aoi)
  .filterDate('2013-06-01', '2015-06-01')
  .select(LC8_BANDS, STD_NAMES)

var pansharpen = function(image) {
    var pan = image.select('pan');
    var rgb = image.select('red', 'green', 'blue');
    var hsv  = rgb.rgbtohsv();
    var huesat = hsv.select('hue', 'saturation');
    var upres = ee.Image.cat(huesat, pan.multiply(2)).hsvtorgb();
 
    return upres;
}

var percentile = l8
  .select(['swir1', 'nir', 'green', 'red', 'blue', 'pan'])
  .reduce(ee.Reducer.percentile([15]))
  .rename(['swir1', 'nir', 'green', 'red', 'blue', 'pan'])
  //.reproject(crs, crs_transform)

Map.addLayer(percentile.mask(dem.gt(0)), {min:0.05, max:0.3}, 'image 15%', false)

Map.addLayer(pansharpen(percentile.mask(dem.gt(0))), {min:0.05, max:[0.3,0.3,0.45]}, 'image 15% pan', false)

var mndwi = percentile
  .normalizedDifference(['green', 'swir1'])

Map.addLayer(mndwi, {min:-0.5, max:0.5, palette: ['ffffff', '00b2ff']}, 'mndwi 15%', false)

var ndwi = percentile
  .normalizedDifference(['green', 'nir'])

Map.addLayer(ndwi, {min:-0.5, max:0.5, palette: ['ffffff', '00b2ff']}, 'ndwi 15%', false)

var water_mask_15 = water_15.expression('r+g+b', {r:water_15.select(0), g:water_15.select(1), b:water_15.select(2)}).gt(0)

var crsTransformSetStep = function(step, t) {
  return [step, t[1], t[2], t[3], -step, t[5]];
}

Map.addLayer(water_15.mask(water_mask_15), {}, 'water 15%', false)

// select small objects
/*  var small = image.subtract(image.focal_min({radius: 30, kernelType: 'square', units: 'meters'}).focal_max({radius: 30, kernelType: 'square', units: 'meters'}))
  Map.addLayer(small.mask(small), {palette:'00b2ff', opacity:0.7}, 'water 15% (smooth), small', false)
  
  small = small
    .focal_max({radius: 15, units: 'meters'})
    .focal_mode({radius: 15, units: 'meters', iterations: 5})
    .focal_min({radius: 15, units: 'meters'})
  
  Map.addLayer(small.mask(small), {palette:'00b2ff', opacity:0.7}, 'water 15% (smooth), small, smooth', false)
*/

function smoothImage(image) {
  image = image
    .focal_max({radius: 10, units: 'meters'})
    //.focal_mode({radius: 25, units: 'meters', iterations: 10})
    .focal_mode({radius: 35, units: 'meters', iterations: 5})
    .focal_min({radius: 10, units: 'meters'})
    //.reproject(crs, crsTransformSetStep(0.15 * crs_transform[0], crs_transform))

  return image;
}

var smooth_skel = null;

function addSmoothedWater() {
  var smooth = smoothImage(water_mask_15)
    //.reproject(crs, crsTransformSetStep(crs_transform[0] / 3.0, crs_transform))
    //.reproject(crs, crs_transform);
  Map.addLayer(smooth.mask(smooth), {palette:'00b2ff', opacity:0.7}, 'water 15% (smooth)', false)
  
  smooth_skel = skeletonize(smooth, 15, 2)
    //.reproject(crs, crsTransformSetStep(crs_transform[0] / 3.0, crs_transform))
  
  Map.addLayer(smooth_skel.mask(smooth_skel).focal_max(), {palette:'fec44f', opacity: 0.7}, 'skeleton (smooth)', false);
}

addSmoothedWater();

Map.addLayer(water_mask_15.mask(water_mask_15), {palette:'00b2ff', opacity:0.7}, 'water mask 15%', true)

var water_edge_15 = getSimpleEdge(water_mask_15, aoi)
Map.addLayer(water_edge_15.mask(water_edge_15), {palette:'5555ff', opacity:0.7}, 'water mask 15% (edge)', false)

// water skeleton
var skel = skeletonize(water_mask_15, 10, 2)
//var skel = skeletonize(water_mask_15.focal_max().focal_max(), 10, 2, crs, crs_transform)
Map.addLayer(skel.mask(skel)/*.focal_max()*/, {palette:'fec44f', opacity: 0.7}, 'skeleton', false);

/**
 * Detects large blobs using:
 * 1. Connected pixel count
 * 2. Skip thin objects detected using morphological opening
 * 3. Delete left small waterbodies
 */
function detectBlobs(mask, minPixelCount, thinFilterErosionSize, thinFilterBufferSize, neighborhoodCheck) {
  var blobs = mask.mask(mask)
    .reproject(crs, crs_transform)
    //.focal_max(1)
    //.focal_min(1)
    .connectedPixelCount(minPixelCount, true)
    .reproject(crs, crs_transform);
  
  Map.addLayer(blobs.mask(blobs.eq(minPixelCount)), {palette:['002200', '00ff00'], min:0, max:minPixelCount}, 'blobs (all), N > ' + minPixelCount, false)

  blobs = blobs.eq(minPixelCount)
    .reproject(crs, crs_transform)
    
  var connectedBlobs = blobs
    .connectedComponents(ee.Kernel.plus(1), 256)
  Map.addLayer(connectedBlobs.randomVisualizer(), {}, 'blobs (connected)', false);
  
  //Map.addLayer(connectedBlobs.mask(connectedBlobs), {palette:['002200', '00ff00'], min: 0, max: 1000}, 'blobs (connected)', false)

  
  var blobMask = blobs.mask()
    .reproject(crs, crs_transform)
    //.focal_max().focal_min()
    .focal_min(thinFilterErosionSize)
    .reproject(crs, crs_transform)
  
  Map.addLayer(blobMask.mask(blobMask), {palette:['00ff00']}, 'blobs (all), erode', false)
  
  var blobMask = blobMask
    .reproject(crs, crsTransformSetStep(4 * crs_transform[0], crs_transform))
    .focal_max(thinFilterBufferSize / 5)
    .reproject(crs, crsTransformSetStep(4 * crs_transform[0], crs_transform))
  
  Map.addLayer(blobMask.mask(blobMask), {palette:['00ff00']}, 'blobs buffer (no thin)', false)
  
  blobs = blobs.mask().and(blobMask)
    .reproject(crs, crs_transform)
  
  Map.addLayer(blobs.mask(blobs), {palette:['00ff00']}, 'blobs masked by buffer (no thin)', false)
  
  blobs = blobs.mask(blobs).connectedPixelCount(minPixelCount, true).eq(minPixelCount)
    .reproject(crs, crs_transform)
  
  Map.addLayer(blobs.mask(blobs), {palette:['00ff00']}, 'blobs', false)
  
  return blobs;
}

function detectRivers() {
  
}

//detectBlobs(water_mask_15, 100, 5, 25)

/*
// remove large blobs
var blob_mask = skel.focal_min(2).focal_max(20)
blob_mask = blob_mask.mask(blob_mask)

Map.addLayer(blob_mask, {palette:'aa0000'}, 'water blobs 15%', false)
var water_mask_15_blobs = water_mask_15.mask(blob_mask)

// remove small parts
var blob_pixel_count = water_mask_15_blobs.mask(water_mask_15_blobs).connectedPixelCount(min_blob_pixels, true);
//Map.addLayer(blob_pixel_count.mask(blob_pixel_count), {min:0, max:min_blob_pixels, palette:['00ff00', 'ff0000']}, 'blob pixel count', false)

water_mask_15_blobs = water_mask_15_blobs.updateMask(water_mask_15_blobs.and(blob_pixel_count.lt(min_blob_pixels).not()))

Map.addLayer(water_mask_15_blobs.mask(water_mask_15_blobs), {palette:'aa0000'}, 'water blobs 15%', false)

//water_mask_15 = water_mask_15.updateMask(water_mask_15.and(water_mask_15_blobs.not()))  
*/

var hand = ee.ImageCollection('GME/layers/02769936315533645832-01676697048325678532').mosaic(); // HAND, M&D

// remove hand outside of handBuffer area around minHand
var handWater = hand.lt(1);

// limit HAND to only high values, drainage network created around low hand values has errors
var handBuffer = 300
var handConfidence = 20; // m

var validHandMask = hand.gte(handConfidence).focal_max({radius: handBuffer, units: 'meters'})

validHandMask = validHandMask
.not()
//.focal_min({radius: 0.5 * handBuffer, units: 'meters'})
.focal_mode({radius: 0.5 * handBuffer, units:'meters', iterations:5})
.focal_max({radius: 0.5 * handBuffer, units: 'meters'})
.not()

// take water only with the high confidence
hand = hand.mask(validHandMask)
handWater = hand.lt(1);

function performBufferOverlayAnalysis(opt_analyzeCurrentMap, opt_exportScores, opt_analyzeDrainageNetwork) {
  var analyzeCurrentMap = opt_analyzeCurrentMap || true;
  var exporScores = opt_exportScores || false;
  var analyzeDrainageNetwork = opt_analyzeDrainageNetwork || false;
  
  var analysisScale = 30
  var minPixelCount = 5

  var buffers = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]
  var bufferNames = []
  var bufferMax = 150
  
  for(var i = 0; i < buffers.length; i++) {
    bufferNames.push('water_buffer_' + buffers[i])
  }

 if(analyzeCurrentMap) {
  if(analyzeDrainageNetwork) {
    var riverRaster = handWater;
  } else {
    var riverRaster = skel;
  }

   // compute scores for differences between OSM and raster river datasets
   for(var i = 0; i < buffers.length; i++) {
      var river_segments_with_buffers = rivers_lines_osm_segments.filterBounds(Map.getBounds(true)).map(function(f) { 
        // compute ratio of valid pixels withing max buffer according to HAND
         // var validHandPixels = validHandMask.mask(validHandMask).reduceRegion(ee.Reducer.count(), f.buffer(bufferMax).geometry(), analysisScale)
         // var total = ee.Number(validHandPixels.get(validHandPixels.keys().get(0)));

        // compute number of water pixels within max buffer
        var result = riverRaster.mask(riverRaster).reduceRegion(ee.Reducer.count(), f.buffer(bufferMax).geometry(), analysisScale)
        var max = ee.Number(result.get(result.keys().get(0)));

        // compute number of water pixels within current buffer  
        var f = f.buffer(buffers[i])
        var result = riverRaster.mask(riverRaster).reduceRegion(ee.Reducer.count(), f.geometry(), analysisScale)
        var count = ee.Number(result.get(result.keys().get(0)));
  
        // compute the difference only
        //var countDiff = count.subtract(countPrev);
        //f = f.set(bufferNames[i], countDiff);
  
        var score = ee.Algorithms.If(count.gte(10 * 30 / analysisScale), count.divide(max), ee.Number(0))
              
        f = f.set('score', score);
        
        return f
      });
      
      Map.addLayer(river_segments_with_buffers.reduceToImage(['score'], ee.Reducer.mean()), {min:0, max:1, palette:['ff0000', '00ff00']}, 'score ' + bufferNames[i], false)
    }
  }

  if(exporScores) {
    function computeBufferScores(f) {
        // compute max
        var result = riverRaster.mask(riverRaster).reduceRegion(ee.Reducer.count(), f.buffer(bufferMax).geometry(), analysisScale)
        var max = ee.Number(result.get(result.keys().get(0)));
  
        // for every clipped feature compute intersection with water for a number of buffers
        var countPrev = ee.Number(0.0)
        if(ee.Algorithms.If(max.gt(minPixelCount), true, false)) {
          for(var i = 0; i < buffers.length; i++) {
            var buffer = f.buffer(buffers[i]).geometry()
            var result = riverRaster.mask(riverRaster).reduceRegion(ee.Reducer.count(), buffer, analysisScale)
            var count = ee.Number(result.get(result.keys().get(0)));
            var countDiff = count.subtract(countPrev);
            var score = ee.Algorithms.If(count.gte(minPixelCount / analysisScale), count.divide(max), ee.Number(0))
    
            f = f.set('N_' + bufferNames[i], count);
            f = f.set('D_' + bufferNames[i], countDiff);
            f = f.set('S_' + bufferNames[i], score);
    
            countPrev = count;
          }
        } else {
            f = f.set('N_' + bufferNames[i], -1);
            f = f.set('D_' + bufferNames[i], -1);
            f = f.set('S_' + bufferNames[i], -1);
        }
        
              
        f = f.set('score', score);
  
        return f;
    }
    
    //print('Feature count:', rivers_lines_osm_segments.length())
    for(var i = 0; i < 35; i++) {
      var river_with_buffers = rivers_lines_osm_segments.limit(1000, i*1000)
        .map(computeBufferScores)
      
      //print(river_with_buffers.first())
      
      var fileName = 'OSM_AU_river_buffers_' + i;
      Export.table(river_with_buffers, fileName,
        { fileFormat: 'GeoJSON', driveFileNamePrefix: fileName})
    }
  }
}

var analyzeDrainageNetwork = true // otherwise L8 vs OSM
var analyzeCurrentMap = true
var exportScores = false
performBufferOverlayAnalysis(analyzeCurrentMap, exportScores, analyzeDrainageNetwork)

// OSM
var rivers_lines_osm_segments_image = ee.Image(0).mask(0).toByte()
                .paint(rivers_lines_osm_segments, 0, 2.0);
Map.addLayer(rivers_lines_osm_segments_image, {palette:['80d9ff'], opacity: 0.7}, 'rivers_lines', false);
Map.addLayer(rivers_lines_osm_segments_image, {palette:['ff3333'], opacity: 0.7}, 'rivers_lines (red)', true);


Map.addLayer(handWater.mask(handWater), {palette:['a0a0ff']}, 'hand water (<1)', false)
Map.addLayer(fa.mask(fa.gt(10).multiply(fa.divide(1000))).visualize({palette:['000000', 'ffffff'], min:10, max:100000}), 
      {}, 'flow accumulation (>10)', false)

Map.addLayer(validHandMask.mask(validHandMask.not()), {}, 'buffer = ' + handBuffer + ' around hand <= ' + handConfidence, false)

Map.addLayer(ee.Image(0).mask(0).toByte()
                .paint(rivers_lines_osm_segments, 'segment', 2.0).randomVisualizer(), {}, 'rivers_line_segments', false);

Map.addLayer(ee.Image(0).mask(0).toByte()
                .paint(rivers_polygons_osm, 'fill')
                .paint(rivers_polygons_osm, 1, 1), {palette: ['80d9ff'], 'opacity': 0.7}, 'rivers_polygons', false);

Map.addLayer(ee.Image(0).mask(0).toByte()
                .paint(rivers_polygons_osm, 'fill')
                .paint(rivers_polygons_osm, 1, 1), {palette: ['ff3333'], 'opacity': 0.7}, 'rivers_polygons (red)', false);

Map.addLayer(grid, {}, 'grid', false)

addToMapAsRaster(grid, 'grid (outline)', ['000000', 'ffffff'], 1, 0.5, false, false)


print('Map scale:', Map.getScale())

Map.addLayer(not_aoi, {}, 'not aoi', true)
