autowatch = 1;
outlets = 1;

var debugLog = true;

var OUTLET_OSC = 0;
var MAX_PARAMS = 32;

setoutletassist(OUTLET_OSC, 'OSC Messages');

var lomSongView = null;
var lomSelectedTrack = null;
var lomTrackDeviceObserver = null;
var lomSelectedDevice = null;
var lomSelectedDeviceParams = null;
var lomParamsArr = [];
var objIdToInstanceId = {};
var payAttentionToValueCallback = true;
var nullString = "- - -";

debug("reloaded");

////////////////////////////////////////////////
// EXTERNAL METHODS
////////////////////////////////////////////////

function bang() {
  setupListener();
}

////////////////////////////////////////////////
// INTERNAL METHODS
////////////////////////////////////////////////

function setupListener() {
  debug("SETUP LISTENER");
  lomSongView = new LiveAPI(trackChangedCallback, "live_set view");
  lomSongView.property = "selected_track";
}

function trackChangedCallback(args) {
  var argsArr = arrayfromargs(args);
  debug(JSON.stringify(argsArr));

  trackNum = argsArr[argsArr.length -1];

  if (trackNum === 0) { return; }

  lomSelectedTrack = new LiveAPI(trackNameChangedCallback, "live_set view selected_track");
  lomSelectedTrack.mode = 1;
  lomSelectedTrack.property = "name";

  lomTrackDeviceObserver = new LiveAPI(deviceChangedCallback, "live_set view selected_track view");
  lomSelectedDeviceObserver.mode = 1;
  lomTrackDeviceObserver.property = "selected_device";
}

function deviceChangedCallback(args) {
  var argsArr = arrayfromargs(args);
  if (argsArr[0] !== 'selected_device') {
    return;
  }
  debug(JSON.stringify(argsArr));

  var deviceId = argsArr[argsArr.length -1];
  if (deviceId === 0) { return; }

  lomSelectedDevice = new LiveAPI(deviceNameChangedCallback, "id " + deviceId);
  lomSelectedDevice.property = "name";

  lomSelectedDeviceParams = new LiveAPI(parametersCallback, "id " + deviceId);
  lomSelectedDeviceParams.property = "parameters";
}

function trackNameChangedCallback() {
  updateDeviceName();
}
function deviceNameChangedCallback() {
  updateDeviceName();
}

function updateDeviceName() {
  message = ["/currDeviceName", lomSelectedTrack.get("name") + " > " + lomSelectedDevice.get("name")];
  debug(message);
  outlet(OUTLET_OSC, message);
}

function paramKey(paramObj) {
  var key = paramObj.id.toString();
  debug(key);
  return key;
}

function parametersCallback(args) {
  var argsArr = arrayfromargs(args);
  if (argsArr[0] !== 'parameters') {
    return;
  }
  //debug(JSON.stringify(argsArr));
  argsArr.shift();

  lomParamsArr = [];
  objIdToInstanceId = {};

  var argsElement;
  var message;
  var currElem;
  var instanceId;
  while (argsArr.length > 0 && lomParamsArr.length < MAX_PARAMS) {
    argsElementValue = argsArr.shift();
    if (argsElementValue === 'id') {
      continue;
    }
    instanceId = lomParamsArr.length;

    currElem = {
      paramObj: new LiveAPI(valueCallback, "id " + argsElementValue)
    };
    objIdToInstanceId[paramKey(currElem.paramObj)] = instanceId;
    currElem.paramObj.property = "value";
    currElem.name = currElem.paramObj.get("name").toString();
    currElem.val = parseFloat(currElem.paramObj.get("value")),
    currElem.min = parseFloat(currElem.paramObj.get("min")) || 0,
    currElem.max = parseFloat(currElem.paramObj.get("max")) || 1,

    lomParamsArr.push(currElem);

    message = ["/param" + lomParamsArr.length, currElem.name];
    outlet(OUTLET_OSC, message);

    sendVal(instanceId);
  }

  // zero-out the rest of the param sliders
  for (var i = lomParamsArr.length + 1; i <= MAX_PARAMS; i++) {
    message = ["/param" + i, nullString];
    outlet(OUTLET_OSC, message);
    message = ["/val" + i, 0];
    outlet(OUTLET_OSC, message);
  }
}

function sendVal(instanceId) {
  if (typeof(instanceId) !== "number" || instanceId < 0 || instanceId > (MAX_PARAMS - 1)) { return; }

  var param = lomParamsArr[instanceId];

  // the value, expressed as a proportion between the param min and max
  var outVal = (param.val - param.min) / (param.max - param.min);

  var message = ['/val' + (instanceId + 1), outVal]
  debug(message);
  outlet(OUTLET_OSC, message);
}

function valueCallback(args) {
  var instanceId = objIdToInstanceId[paramKey(this)];
  if (instanceId === undefined) {
    debug('no objIdToInstanceId for', instanceId, JSON.stringify(objIdToInstanceId));
    return;
  }
  if (!lomParamsArr[instanceId]) {
    debug('no lomParamsArr for', instanceId, JSON.stringify(lomParamsArr));
    return;
  }

  var argsArr = arrayfromargs(args);

  // ensure the value is indeed changed (vs a feedback loop)
  if (argsArr[1] === lomParamsArr[instanceId].val) {
    debug(instanceId, instanceId.val, "NO CHANGE");
    return;
  }
  lomParamsArr[instanceId].val = argsArr[1];
  sendVal(instanceId);
}

function oscReceive(args) {
  var matches = args.match(/^\/val(\d+) ([0-9.-]+)$/);

  if (!matches || matches.length !== 3) {
    return;
  }

  var instanceId = parseInt(matches[1]) - 1;
  var instanceObj = lomParamsArr[instanceId];
  var value = instanceObj.min + (parseFloat(matches[2]) * (instanceObj.max - instanceObj.min));
  instanceObj.paramObj.set("value", value);
}

/*

function instanceIdIsValid() {
  return instanceId && instanceId !== 'NULL';
}

function setupPathListenerIfNecessary() {
  if (!instanceIdIsValid()) { return; }
  if (!pathListener) {
    pathListener = new ParameterListener("path" + instanceId, pathChangedCallback)
  }
}

function setPathParam(path) {
  setupPathListenerIfNecessary();
  pathListener.setvalue_silent(path);
}

function doInit() {
  debug();

  setupPathListenerIfNecessary();
  var currPathVal = pathListener.getvalue()
  debug('currPathVal=', currPathVal);

  if (isValidPath(currPathVal)) {
    setPath(currPathVal);
  } else {
    init();
  }
}

function clearPath() {
  debug();
  init();
}

function init() {
  debug("INIT");
  if (paramObj) {
    // clean up callbacks when unmapping
    paramObj.id = 0;
  }
  paramObj = null;
  param = {
    val: 0,
    min: 0,
    max: 100
  };
  sendNames();
  sendVal();
  outlet(OUTLET_MAPPED, false);

  setPathParam('');

  if (deviceCheckerTask !== null) {
    deviceCheckerTask.cancel();
    deviceCheckerTask = null;
  }
}

function setMin(val) {
  debug(val);
  outMin = parseFloat(val) / 100;
  sendVal();
}

function setMax(val) {
  debug(val);
  outMax = parseFloat(val) / 100;
  sendVal();
}

function paramValueCallback(args) {
  // This function is called whenever the parameter value changes,
  // either via OSC control or by changing the device directly.
  // We need to distinguish between the two and not do anything if the
  // value was changed due to OSC input. Otherwise, we would create a feedback
  // loop since this the purpose of this function is to update the displayed
  // value on the OSC controller to show automation or direct manipulation.
  // We accomplish this by keeping a timestamp of the last time OSC data was
  // received, and only taking action here if more than 500ms has passed.

  debug(args, "ALLOW_UPDATES=", allowParamValueUpdates);
  if (allowParamValueUpdates) { // ensure 500ms has passed since receiving a value
    var args = arrayfromargs(args);
    if (args[0] === 'value') {
      //post("PARAM_VAL", typeof(args[1]), args[1], "\n");
      param.val = args[1];
      sendVal();
    } else {
      debug('SUMPIN ELSE', args[0], args[1]);
    }
  }
}

function paramNameCallback(args) {
  debug(args);
  var args = arrayfromargs(args);
  if (args[0] === 'name') {
    param.name = args[1];
    sendParamName();
  }
}

function deviceNameCallback(args) {
  debug(args);
  var args = arrayfromargs(args);
  if (args[0] === 'name') {
    param.deviceName = args[1];
    sendDeviceName();
  }
}

function trackNameCallback(args) {
  debug(args);
  var args = arrayfromargs(args);
  if (args[0] === 'name') {
    param.trackName = args[1];
    sendTrackName();
  }
}

function colorToString(colorVal) {
  var retString = parseInt(colorVal).toString(16).toUpperCase();
  for (var i = 0; i < 6 - retString.length; i++) {
    retString = "0" + retString;
  }
  return retString + 'FF';
}

function trackColorCallback(args) {
  debug("TRACKCOLOR", args);
  var args = arrayfromargs(args);
  if (args[0] === 'color') {
    param.trackColor = colorToString(args[1]);
    sendColor();
  }
}

function checkDevicePresent() {
  //debug('PO=', paramObj.unquotedpath, 'PP=', param.path, 'PL=', pathListener.getvalue());
  if (!deviceObj.unquotedpath) {
    debug('DEVICE DELETED');
    init();
    return;
  }

  // check if path has changed (e.g. inserting a track above this one)
  if (paramObj && paramObj.unquotedpath !== param.path) {
    debug('path is different  NEW=', paramObj.unquotedpath, '  OLD=', param.path);
    pathListener.setvalue_silent(paramObj.unquotedpath);
    param.path = paramObj.unquotedpath;
  }
}


function setPath(paramPath) {
  debug(paramPath);
  if (!isValidPath(paramPath)) {
    debug('skipping', paramPath);
    return;
  }
  paramObj = new LiveAPI(paramValueCallback, paramPath);
  paramObj.property = "value";
  paramNameObj = new LiveAPI(paramNameCallback, paramPath);
  paramNameObj.property = "name";

  param = {
    id: parseInt(paramObj.id),
    path: paramObj.unquotedpath,
    val: parseFloat(paramObj.get("value")),
    min: parseFloat(paramObj.get("min")) || 0,
    max: parseFloat(paramObj.get("max")) || 1,
    name: paramObj.get("name"),
  };
  debug('SET PARAM', JSON.stringify(param));

  deviceObj = new LiveAPI(deviceNameCallback, paramObj.get("canonical_parent"));

  var devicePath = deviceObj.unquotedpath;

  debug("PARAMPATH=", paramObj.unquotedpath, "DEVICEPATH=", deviceObj.unquotedpath);

  // poll to see if the mapped device is still present
  deviceCheckerTask = new Task(checkDevicePresent)
  deviceCheckerTask.repeat();

  // Only get the device name if it has the name property
  if (deviceObj.info.match(/property name str/)) {
    deviceObj.property = "name";
    param.deviceName = deviceObj.get("name");
  } else if (param.path.match(/mixer_device/)) {
    param.deviceName = 'Mixer';
  }

  // Try to get the track name
  var matches = (
    devicePath.match(/^live_set tracks \d+/)
    ||
    devicePath.match(/^live_set return_tracks \d+/)
    ||
    devicePath.match(/^live_set master_track/)
  );
  if (matches) {
    debug(matches[0]);
    trackObj = new LiveAPI(trackNameCallback, matches[0]);
    if (trackObj.info.match(/property name str/)) {
      trackObj.property = "name";
      param.trackName = trackObj.get("name");
    } else if (param.path.match(/mixer_device/)) {
      param.trackName = 'Mixer';
    }

    trackColorObj = new LiveAPI(trackColorCallback, matches[0]);
    trackColorObj.property = "color";
    param.trackColor = colorToString(trackColorObj.get("color"));
  }

  //post("PARAM DATA", JSON.stringify(param), "\n");
  outlet(OUTLET_MAPPED, true);
  setPathParam(param.path);

  // Defer outputting the new param val because the controller
  // will not process it since it was just sending other vals
  // that triggered the mapping.
  (new Task( function() { sendVal(); } )).schedule(333);
  sendNames();
}

function refresh() {
  sendNames();
  sendVal();
}

function sendNames() {
  debug(param.name, param.deviceName, param.trackName);
  sendParamName();
  sendDeviceName();
  sendTrackName();
  sendColor();
}

function sendParamName() {
  debug();
  if (!instanceIdIsValid()) { debug("invalid instanceId"); return; }
  var paramName = param.name ? dequote(param.name.toString()) : nullString;
  outlet(OUTLET_PARAM_NAME, paramName);
  outlet(OUTLET_OSC, ['/param' + instanceId, paramName]);
}
function sendDeviceName() {
  if (!instanceIdIsValid()) { debug("invalid instanceId"); return; }
  var deviceName = param.deviceName ? dequote(param.deviceName.toString()) : nullString;
  outlet(OUTLET_DEVICE_NAME, deviceName);
  outlet(OUTLET_OSC, ['/device' + instanceId, deviceName]);
}
function sendTrackName() {
  if (!instanceIdIsValid()) { debug("invalid instanceId"); return; }
  var trackName = param.trackName ? dequote(param.trackName.toString()) : nullString;
  outlet(OUTLET_TRACK_NAME, trackName);
  outlet(OUTLET_OSC, ['/track' + instanceId, trackName]);
}
function sendColor() {
  if (!instanceIdIsValid()) { debug("invalid instanceId"); return; }
  var trackColor = param.trackColor ? dequote(param.trackColor.toString()) : "FF0000FF";
  //debugLog=true;
  debug("SENDCOLOR", instanceId, trackColor);
  //debugLog=false;
  outlet(OUTLET_OSC, ['/val' + instanceId + 'color', trackColor]);
}

function sendVal() {
  if (!instanceIdIsValid()) { return; }
  //debug();
  // protect against divide-by-zero errors
  if (outMax === outMin) {
    if (outMax === 1) {
      outMin = 0.99;
    } else if (outMax === 0) {
      outMax = 0.01;
    }
  }

  if (param.val === undefined || param.max === undefined || param.min === undefined) {
    outlet(OUTLET_OSC, ['/val' + instanceId, 0]);
    return;
  }

  // the value, expressed as a proportion between the param min and max
  var valProp = (param.val - param.min) / (param.max - param.min);

  debug("VALPROP", valProp, JSON.stringify(param), "OUTMINMAX", outMin, outMax);

  // scale the param proportion value to the output min/max proportion
  var scaledValProp = ((valProp - outMin) / (outMax - outMin));

  scaledValProp = Math.min(scaledValProp, 1);
  scaledValProp = Math.max(scaledValProp, 0);

  debug("SCALEDVALPROP", '/val' + instanceId, scaledValProp);

  outlet(OUTLET_OSC, ['/val' + instanceId, scaledValProp]);
}

function receiveVal(val) {
  //debug(val);
  if (paramObj) {
    if (allowUpdateFromOsc) {
      //post('INVAL', val, 'OUTMIN', outMin, 'OUTMAX', outMax, '\n');
      var scaledVal = ((outMax - outMin) * val) + outMin;
      param.val = ((param.max - param.min) * scaledVal) + param.min;

      //debug('VALS', JSON.stringify({ param_max: param.max, param_min: param.min, scaledVal: scaledVal, val: val }));

      // prevent updates from params directly being sent to OSC for 500ms
      if (allowParamValueUpdates) {
        allowParamValueUpdates = false;
        if (allowParamValueUpdatesTask !== null) {
          allowParamValueUpdatesTask.cancel();
        }
        allowParamValueUpdatesTask = new Task( function() { allowParamValueUpdates = true; } );
        allowParamValueUpdatesTask.schedule(500);
      }

      //post('PARAMVAL', param.val, "\n");
      paramObj.set("value", param.val);
    }
  } else {
    debug("GONNA_MAP", "ALLOWED=", allowMapping);
    // If we get a OSC value but are unassigned, trigger a mapping.
    // This removes a step from typical mapping.
    if (allowMapping) {
      // debounce mapping, since moving the CC will trigger many message
      allowMapping = false;
      (new Task( function() { allowMapping = true; } )).schedule(1000);

      // wait 500ms before paying attention to values again after mapping
      if (allowUpdateFromOsc) {
        allowUpdateFromOsc = false;
        (new Task( function() { allowUpdateFromOsc = true; } )).schedule(500);
      }

      //post("PRE-SELOBJ\n");
      var selObj = new LiveAPI("live_set view selected_parameter");
      if (!selObj.unquotedpath) {
        post("No Live param is selected.\n");
      } else {
        debug("SELOBJ", selObj.unquotedpath, "SELOBJINFO", selObj.info);
        // Only map things that have a 'value' property
        if (selObj.info.match(/property value/)) {
          setPath(selObj.unquotedpath);
        }
      }
    }
  }
}
*/

////////////////////////////////////////////////
// UTILITIES
////////////////////////////////////////////////

function debug() {
  if (debugLog) {
    post(debug.caller ? debug.caller.name : 'ROOT', Array.prototype.slice.call(arguments).join(" "), "\n");
  }
}

function dequote(str) {
  return str.replace(/^"|"$/g, '');
}

