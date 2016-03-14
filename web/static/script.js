var OPACITY_MAX_PIXELS = 57; // Width of opacity control image

function radians(img) { return img.toFloat().multiply(3.1415927).divide(180); }

// DEM Hillshade function - Compute hillshade for the given illumination az, el.
function hillshade(az, ze, slope, aspect) {
  var azimuth = radians(ee.Image(az));
  var zenith = radians(ee.Image(ze));
  return azimuth.subtract(aspect).cos().multiply(slope.sin()).multiply(zenith.sin())
      .add(zenith.cos().multiply(slope.cos()));
}

function hillshadeit(image, elevation, weight, height_multiplier, azimuth, zenith) {
  var hsv  = image.unitScale(0, 255).rgbtohsv();
  var terrain = ee.call('Terrain', elevation.multiply(height_multiplier));
  var slope = radians(terrain.select(['slope']));

  var aspect = radians(terrain.select(['aspect'])).resample('bicubic');
  var hs = hillshade(azimuth, zenith, slope, aspect).resample('bicubic');

  var intensity = hs.multiply(weight).multiply(hsv.select('value'));
  var huesat = hsv.select('hue', 'saturation');

  return ee.Image.cat(huesat, intensity).hsvtorgb();
}

function renderDem() {
  var aoi = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

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

  var azimuth = 90;
  var zenith = 15;
  var dem = ee.Image('USGS/SRTMGL1_003');

  var gaussianKernel = ee.Kernel.gaussian(2, 1, 'pixels', true, 2);
  dem = dem.convolve(gaussianKernel);

  var v = dem.clip(aoi).sldStyle(style_dem);

  return hillshadeit(v, dem, 1.1, 2.0, azimuth, zenith);
}

function renderHand() {
  var colors_hand = ['023858', '006837', '1a9850', '66bd63', 'a6d96a', 'd9ef8b', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd73027'];
  var hand = ee.ImageCollection('GME/layers/02769936315533645832-09600968974022224798').mosaic(); // HAND, M&D
  var dem = ee.Image('USGS/SRTMGL1_003')

  var azimuth = 90;
  var zenith = 30;

  dem = dem.convolve(ee.Kernel.gaussian(2, 1, 'pixels', true, 2));

  hand = hand.convolve(ee.Kernel.gaussian(1, 1, 'pixels', true, 1));

  return hillshadeit(hand.visualize({min:-1, max:30, palette:colors_hand}), dem, 1.1, 2, azimuth, zenith);
}

function renderHandMask() {
   var hand = ee.ImageCollection('GME/layers/02769936315533645832-09600968974022224798').mosaic(); // HAND, M&D

   var handBuffer = 240
   var handConfidence = 30; // m
   
   var invalidHandMask = hand.lt(handConfidence)
	.focal_min({radius: handBuffer, units: 'meters'})
        .focal_mode({radius: 0.5 * handBuffer, units:'meters', iterations:5})
        .focal_max({radius: handBuffer, units: 'meters'})

   invalidHandMask = ee.Image(1).mask(invalidHandMask)
      //.focal_max({radius: handBuffer, units: 'meters'})
      //.focal_min({radius: handBuffer, units: 'meters'})

   return invalidHandMask.visualize({});
}

function renderFlowAccumulation() {
   var fa = ee.Image("users/gena/AU_Murray_Darling/SRTM_30_Murray_Darling_flow_accumulation");
   //return fa.mask(fa.gt(100)).visualize({palette:['505000', 'bb9900'], min:100, max:100000});
   return fa.mask(fa.gt(10).multiply(fa.divide(1000)))
      //.focal_max({radius:15, units:'meters'})
      .visualize({palette:['ffffff', '000000'], min:10, max:100000});
}

function renderRiversHand() {
  var hand = ee.ImageCollection('GME/layers/02769936315533645832-09600968974022224798').mosaic();

  var river = ee.Image(hand.lt(1))
    //.focal_max({radius: 10, units: 'meters'})
    //.focal_mode({radius: 15, units: 'meters', iterations: 5})

  return river.mask(river).visualize({palette:['6060ee'], opacity: 1.0});
}

function renderRiversHydroSheds() {
  var aoi = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

  var fc = new ee.FeatureCollection('ft:1xfvGA2mK7nNrt0S7asJR-lZXDa5fOPAgCsxUlM17');

  var rivers = [
    fc.filter(ee.Filter.gt('UP_CELLS', 0).and(ee.Filter.lte('UP_CELLS', 1000))),
    fc.filter(ee.Filter.gt('UP_CELLS', 1000).and(ee.Filter.lte('UP_CELLS', 10000))), 
    fc.filter(ee.Filter.gt('UP_CELLS', 10000).and(ee.Filter.lte('UP_CELLS', 100000))),
    fc.filter(ee.Filter.gt('UP_CELLS', 100000).and(ee.Filter.lte('UP_CELLS', 500000))),
    fc.filter(ee.Filter.gt('UP_CELLS', 500000).and(ee.Filter.lte('UP_CELLS', 2000000))),
    fc.filter(ee.Filter.gt('UP_CELLS', 2000000).and(ee.Filter.lte('UP_CELLS', 5000000)))
  ];

 var style_rivers = '\
  <RasterSymbolizer>\
    <ColorMap  type="intervals" extended="false" >\
      <ColorMapEntry color="#8856a7" quantity="0" label="0" />\
      <ColorMapEntry color="#8856a7" quantity="1" label="1000" />\
      <ColorMapEntry color="#8856a7" quantity="2" label="10000" />\
      <ColorMapEntry color="#8856a7" quantity="3" label="100000" />\
      <ColorMapEntry color="#8856a7" quantity="4" label="500000" />\
      <ColorMapEntry color="#8856a7" quantity="5" label="2000000" />\
    </ColorMap>\
  </RasterSymbolizer>';

  var rivers_image = ee.Image(0).mask(0).toByte();
  var count = 6;
  var size_multiplier = 1.5
  for(var i=0; i<count; i++) {
    rivers_image = rivers_image.paint(rivers[i], i, i*size_multiplier + 1);
  }

  return rivers_image.mask(ee.Image(rivers_image.mask().multiply(0.7))).clip(aoi).sldStyle(style_rivers);
}

function smoothen(image) {
  image = image
    .focal_max({radius: 14, units: 'meters'})
    .focal_mode({radius: 30, units: 'meters', iterations: 5})
    .focal_min({radius: 14, units: 'meters'})

  return image;
}

function renderWaterLandsatSmooth() {
  var water_15 = ee.Image("users/gena/AU_Murray_Darling/MNDWI_15_water_WGS");
  var water_mask_15 = water_15.expression('r+g+b', {r:water_15.select(0), g:water_15.select(1), b:water_15.select(2)}).gt(0)

  water_mask_15 = smoothen(water_mask_15).focal_max({radius: 30, units: 'meters'}).or(water_mask_15);

  return water_mask_15.mask(water_mask_15).visualize({palette:'00b2ff'});
}

function renderWaterLandsat() {
  var water_15 = ee.Image("users/gena/AU_Murray_Darling/MNDWI_15_water_WGS");
  var water_mask_15 = water_15.expression('r+g+b', {r:water_15.select(0), g:water_15.select(1), b:water_15.select(2)}).gt(0)

  return water_mask_15.mask(water_mask_15).visualize({palette:'00b2ff'});
}

function renderLandsat8(percentile) {
  var aoi = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

  var l8 = ee.ImageCollection('LANDSAT/LC8_L1T_TOA')
    .filterBounds(aoi)
    .filterDate('2013-06-01', '2015-06-01')
    .select(['B6', 'B5', 'B3'])
    .reduce(ee.Reducer.percentile([percentile]))
    .clip(aoi)
  
  return l8.visualize({min:0.05, max:[0.3, 0.3, 0.4], gamma:1.0})
}

function renderWaterOSM(opt_color) {
  var color = opt_color || 'aaaaff'
 
  var rivers_lines_osm = ee.FeatureCollection('ft:1nlWWjT4VkGjkp-kXKroFuyUuKDUSTqce_DDtmOt1')
  var rivers_polygons_osm = ee.FeatureCollection('ft:1gUbHjPLpeC4Vzi59vE5JSFfLRDtcrngyWfSn8mQC');

  var rivers_image = ee.Image(0).mask(0).toByte();
  rivers_image = rivers_image.paint(rivers_lines_osm, 1, 1);
  rivers_image = rivers_image.paint(rivers_polygons_osm, 1);
  rivers_image = rivers_image.focal_max({radius:15, units:'meters'});

  return rivers_image.mask(rivers_image).visualize({palette:[color, color]});
}

function renderCatchment() {
  var au_catchments_level3 = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
  var aoi = au_catchments_level3
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

  var image = ee.Image(0).mask(0).toByte();
  image = image.paint(aoi, 1);
  return image.mask(image).visualize({palette:['000000'], opacity: 1.0});
}

function renderCatchmentBoundary() {
  var au_catchments_level3 = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
  var aoi = au_catchments_level3
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

  var image = ee.Image(0).mask(0).toByte();
  image = image.paint(aoi, 1, 2);
  return image.mask(image).visualize({palette:['FFFFFF'], opacity: 1.0});
}

function renderHandClasses() {
  var hand = ee.Image("users/gena/AU_Murray_Darling/SRTM_30_Murray_Darling_hand");
  var dem = ee.Image('USGS/SRTMGL1_003')

  //var terrain = ee.call('Terrain', dem);

  var gaussianKernel = ee.Kernel.gaussian(3, 2, 'pixels', true, 2);
  var terrain = ee.call('Terrain', dem.convolve(gaussianKernel));
  
  var slope = radians(terrain.select(['slope']))
    .lt(0.076)
    
  //Map.addLayer(slope.mask(slope), {palette:'000000'}, 'slope < 0.076', false)

  slope = slope
    .focal_max({radius: 50, units: 'meters'})
    //.focal_mode({radius: 55, units: 'meters', iterations:5})
    .focal_min({radius: 50, units: 'meters'})

  //Map.addLayer(slope.mask(slope), {palette:'000000'}, 'slope < 0.076 (smoothed)', false)

  var hand_class = hand.addBands(slope).expression(
    "(b(0) <= 5.3) ? 0 \
      : (b(0) <= 15 && b(0) > 5.3 ) ? 1 \
      : (b(0) > 15 && b(1) == 0 ) ? 2 \
      : (b(0) > 15 && b(1) == 1 ) ? 3 \
      : 0"
  );
  
  var style_hand_classes = '\
  <RasterSymbolizer>\
    <ColorMap  type="intervals" extended="false" >\
      <ColorMapEntry color="#000055" quantity="0" label="Waterlogged"/>\
      <ColorMapEntry color="#00ff00" quantity="1" label="Ecotone"/>\
      <ColorMapEntry color="#ffff00" quantity="2" label="Slope" />\
      <ColorMapEntry color="#ff0000" quantity="3" label="Plateau" />\
    </ColorMap>\
  </RasterSymbolizer>';
  
  var azimuth = 90;
  var zenith = 30;

  //var hand_class_vis = hand_class.visualize({palette: colors_hand_classes})
  var hand_class_vis = hand_class
    //.focal_mode({radius:29, units:'meters', iterations:5})
    //.focal_mode({radius:0.8, iterations:5})
    //.focal_max({radius: 30, units: 'meters'})
    //.focal_min({radius: 30, units: 'meters'})
    .sldStyle(style_hand_classes)

  var aoi = ee.FeatureCollection('ft:1778IyIZLZKSKVgko9X3aIV94E7jcm28uniyD6ycp')
    .filter(ee.Filter.eq('HYBAS_ID', 5030073410));

  return hillshadeit(hand_class_vis.clip(aoi), dem, 1.1, 2, azimuth, zenith)
}

function addLayer(map, index, layer, callback) {
  var mapId = layer.getMap({}, function (mapId, error) {
    if (error) {
      console.log(error);
    }

    var id = mapId.mapid;
    var token = mapId.token;

    // The Google Maps API calls getTileUrl() when it tries to display a map
    // tile.  This is a good place to swap in the MapID and token we got from
    // the Python script. The other values describe other properties of the
    // custom map type.
    var eeMapOptions = {
      getTileUrl: function(tile, zoom) {
        if(map.overlayMapTypes.getAt(index).opacity < 0.01) {
          return '';
        }

        var baseUrl = 'https://earthengine.googleapis.com/map';
        var url = [baseUrl, id, zoom, tile.x, tile.y].join('/');
        url += '?token=' + token;

        //console.log(map.overlayMapTypes.getAt(index).opacity + ' ' + url)

        return url;
      },
      tileSize: new google.maps.Size(256, 256)
    };

    // Create the map type.
    var mapType = new google.maps.ImageMapType(eeMapOptions);

    // Add the EE layer to the map.
    map.overlayMapTypes.setAt(index, mapType);

    mapType.setOpacity(0.1);

    if (callback) {
      callback();
    }
  });
}

var initialize = function() {
  var myLatLng = new google.maps.LatLng(-32.248232, 145.546875);

  var mapOptions = {
    center: myLatLng,
    zoom: 7,
    //maxZoom: 15,
    maxZoom: 25,
    draggable: true,
    streetViewControl: true,
    scaleControl: true, 
    scaleControlOptions: { position: google.maps.ControlPosition.BOTTOM_RIGHT } 
  };

  // Create the base Google Map.
  var map = new google.maps.Map(document.getElementById('map'), mapOptions);
  map.setMapTypeId(google.maps.MapTypeId.TERRAIN);


  var layerCount = 0;
  var maxLayerCount =  16;

  function onLayerAdded() {
    layerCount++;

    if (layerCount < maxLayerCount) {
      return;
    }

    // OSM water (red)
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(14), 'OSM (red)', 14);

    // OSM water
    var initialOpacity = 70;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(13), 'OSM', 13);

    // HydroSHEDS
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(12), 'HydroSHEDS', 12);

    // Landsat water
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(11), 'Water LS', 11);

    // Landsat water
    var initialOpacity = 70;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(10), 'Water L', 10);

    // HAND mask
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(9), 'HAND mask', 9);

    // HAND rivers
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(8), 'HAND < 1m', 8);

    // flow accumulation
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(7), 'Flow Acc', 7);

    // HAND classdes
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(6), 'HAND class', 6);

    // HAND
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(5), 'HAND', 5);

    // DEM
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(4), 'DEM', 4);
                                                                      
    // Landsat 8 35%
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(3), 'Landsat, 35%', 3);

    // Landsat 8 25%
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(2), 'Landsat, 25%', 2);

    // Landsat 8 15%
    var initialOpacity = 1;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(1), 'Landsat, 15%', 1);

    // Catchment
    var initialOpacity = 85;
    createOpacityControl(map, initialOpacity, map.overlayMapTypes.getAt(0), 'Catchment', 0);
  }

  addLayer(map, 0, renderCatchment(), onLayerAdded);
  addLayer(map, 1, renderLandsat8(15), onLayerAdded);
  addLayer(map, 2, renderLandsat8(25), onLayerAdded);
  addLayer(map, 3, renderLandsat8(35), onLayerAdded);
  addLayer(map, 4, renderDem(), onLayerAdded);
  addLayer(map, 5, renderHand(), onLayerAdded);
  addLayer(map, 6, renderHandClasses(), onLayerAdded);
  addLayer(map, 7, renderFlowAccumulation(), onLayerAdded);
  addLayer(map, 8, renderRiversHand(), onLayerAdded);
  addLayer(map, 9, renderHandMask(), onLayerAdded);
  addLayer(map, 10, renderWaterLandsat(), onLayerAdded);
  addLayer(map, 11, renderWaterLandsatSmooth(), onLayerAdded);
  addLayer(map, 12, renderRiversHydroSheds(), onLayerAdded);
  addLayer(map, 13, renderWaterOSM(), onLayerAdded);
  addLayer(map, 14, renderWaterOSM('ff2020'), onLayerAdded);
  addLayer(map, 15, renderCatchmentBoundary(), onLayerAdded);



  /*
  var infowindow = new google.maps.InfoWindow({
    content: 'Change the zoom level',
    position: myLatLng
  });
  infowindow.open(map);

  google.maps.event.addListener(map, 'zoom_changed', function() {
    var zoomLevel = map.getZoom();
    map.setCenter(myLatLng);
    infowindow.setContent('Zoom: ' + zoomLevel);
    layerHand.setMap(null);
  });
  */

  /*
  // add catchments
  layer = new google.maps.FusionTablesLayer({
      map: map,
      heatmap: { enabled: false },
      query: {
        select: "col15",
        from: "13dShZ5yGqCEqk3dsJvYEL3lsa1hEmpMRldxK7aSa",
        where: ""
      },
      options: {
        styleId: 2,
        templateId: 2
      }
    });
  */
};



/*
  // add catchments
  layer = new google.maps.FusionTablesLayer({
      map: map,
      heatmap: { enabled: false },
      query: {
        select: "col15",
        from: "13dShZ5yGqCEqk3dsJvYEL3lsa1hEmpMRldxK7aSa",
        where: ""
      },
      options: {
        styleId: 2,
        templateId: 2
      }
    });


*/

function createOpacityControl(map, opacity, overlay, title, index) {
	var sliderImageUrl = "/static/opacity-slider3d14.png";
	
	// Create main div to hold the control.
	var opacityDiv = document.createElement('DIV');
	opacityDiv.setAttribute("style", "margin:5px;overflow-x:hidden;overflow-y:hidden;background:url(" + sliderImageUrl + ") no-repeat;width:71px;height:30px;cursor:pointer;");
	// Create knob
	var opacityKnobDiv = document.createElement('DIV');
	opacityKnobDiv.setAttribute("style", "padding:0;margin:0;overflow-x:hidden;overflow-y:hidden;background:url(" + sliderImageUrl + ") no-repeat -71px 0;width:14px;height:21px;");
	opacityDiv.appendChild(opacityKnobDiv);

        // title
	var opacityTitleDiv = document.createElement('DIV');
	opacityTitleDiv.setAttribute("style", "text-align:center;border:0px solid;margin-top: 18px;text-shadow: 1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white;");
        opacityTitleDiv.appendChild(document.createTextNode(title))
        opacityDiv.appendChild(opacityTitleDiv);

	var opacityCtrlKnob = new ExtDraggableObject(opacityKnobDiv, {
		restrictY: true,
		container: opacityDiv
	});
	google.maps.event.addListener(opacityCtrlKnob, "drag", function () {
		setOpacity(map, opacityCtrlKnob.valueX(), overlay, index);
	});
	google.maps.event.addDomListener(opacityDiv, "click", function (e) {
		var left = findPosLeft(this);
		var x = e.pageX - left - 5; // - 5 as we're using a margin of 5px on the div
		opacityCtrlKnob.setValueX(x);
		setOpacity(map, x, overlay, index);
	});
	map.controls[google.maps.ControlPosition.RIGHT_TOP].push(opacityDiv);
	// Set initial value
	var initialValue = OPACITY_MAX_PIXELS / (100 / opacity);
	opacityCtrlKnob.setValueX(initialValue);
	setOpacity(map, initialValue, overlay);
}
function setOpacity(map, pixelX, overlay, index) {
	// Range = 0 to OPACITY_MAX_PIXELS

	var value = (100 / OPACITY_MAX_PIXELS) * pixelX;
	if (value < 0.01) value = 0;

        //console.log('Opacity: ' + value);

	if (value === 0) {
                var oldOpacity = overlay.getOpacity();
                if(oldOpacity >= 0.01) { // was shown
                  //console.log('hide')
                  overlay.setOpacity(0);
                }
	}
	else {
                var oldOpacity = overlay.getOpacity();
                if(oldOpacity < 0.01) { // was hidden
                   //console.log('show')
                   map.overlayMapTypes.setAt(index, overlay);
                }
		overlay.setOpacity(value / 100.0);
	}
}
function findPosLeft(obj) {
	var curleft = 0;
	if (obj.offsetParent) {
		do {
			curleft += obj.offsetLeft;
		} while (obj = obj.offsetParent);
		return curleft;
	}
	return undefined;
}