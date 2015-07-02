// vim: set ts=2 sw=2 tw=99 et:
function ChartController(app)
{
  this.app = app;
  this.activeHover = null;
  this.data = {};
}

ChartController.prototype.clear = function()
{
  this.removeHover();
  
  // Clear callbacks for XHR.
  for (var key in this.data) {
    var state = this.data[key];
    if (state.callbacks)
      state.callbacks = [];
  }

  $("#viewport").empty();
}

ChartController.prototype.removeHover = function()
{
  if (!this.activeHover)
    return;
  this.activeHover.remove();
  this.activeHover = null;
}

ChartController.prototype.prepareChartDiv = function (id, title, width, height)
{
  var elt = $('<div/>', {
    id: id,
    width: width,
    height: height
  });
  $('#viewport').append(
    $('<h4></h4>').text(title)
  );
  $('#viewport').append(elt);
  $('#viewport').append($('<br>'));
  $('#viewport').append($('<br>'));
  return elt;
}

ChartController.prototype.drawPieChart = function (elt, data)
{
  data.sort(function(a, b) {
    return b.data - a.data;
  });
  var percentages = {};
  var total = 0;
  for (var i = 0; i < data.length; i++)
    total += data[i].data;
  for (var i = 0; i < data.length; i++)
    percentages[data[i].label] = ((data[i].data / total) * 100).toFixed(1);

  $.plot(elt, data, {
    series: {
      pie: {
        show: true,
        label: {
          show: false,
        },
      },
    },
    legend: {
      show: true,
      labelFormatter: function(label, series) {
        return label + ' - ' + percentages[label] + '%';
      },
    },
    grid: {
      hoverable: true,
      clickable: true,
    },
  });
  elt.bind('plothover', (function (event, pos, obj) {
    if (!obj) {
      this.removeHover();
      return;
    }
    if (this.activeHover) {
      if (this.activeHover.id == event.target && this.activeHover.label == obj.seriesIndex)
        return;
      this.removeHover();
    }

    var label = data[obj.seriesIndex].label;
    var text = label + " - " + percentages[label] + "% (" + data[obj.seriesIndex].data + " sessions)";

    this.activeHover = new ToolTip(event.target, obj.seriesIndex, text);
    this.activeHover.draw(pos.pageX, pos.pageY);
  }).bind(this));
}

ChartController.prototype.drawTable = function(selector, devices)
{
  var GetDeviceName = function(device) {
    if (device in PCIDeviceMap)
      return PCIDeviceMap[device];
    var parts = device.split('/');
    if (parts.length == 2)
      return LookupVendor(parts[0]) + ' ' + parts[1];
    return device;
  }

  var device_list = [];
  var total = 0;
  for (var device in devices) {
    total += devices[device];
    device_list.push({
      name: GetDeviceName(device),
      count: devices[device]
    });
  }
  device_list.sort(function(a, b) {
    return b.count - a.count;
  });

  var table = $('<table></table>');
  for (var i = 0; i < device_list.length; i++) {
    var row = $('<tr></tr>');
    row.append($('<td>' + device_list[i].name + '</td>'));
    row.append($('<td>' + ((device_list[i].count / total) * 100).toFixed(2) + '%</td>'));
    row.append($('<td>(' + device_list[i].count + ')</td>'));
    table.append(row);
  }
  $(selector).append(table);
}

ChartController.prototype.ensureData = function (key, callback)
{
  if (key in this.data && this.data[key].obj)
    return this.data[key].obj;

  var state = this.data[key];
  if (!state) {
    state = {
      callbacks: [],
      obj: null,
    };
    this.data[key] = state;
  }

  state.callbacks.push(callback);

  $.ajax({
    url: 'data/' + key
  }).done(function (data) {
    state.obj = (typeof data == 'string')
                ? JSON.parse(data)
                : data;

    var callbacks = state.callbacks;
    state.callbacks = null;

    for (var i = 0; i < callbacks.length; i++)
      callbacks[i](state.obj);
  });
}

// Combine unknown keys into one key, aggregating it.
ChartController.prototype.reduce = function (data, combineKey, threshold, callback)
{
  var total = 0;
  for (var key in data)
    total += data[key];

  for (var key in data) {
    if (callback(key) && (data[key] / total >= threshold))
      continue;
    data[combineKey] = (data[combineKey] | 0) + data[key];
    delete data[key];
  }
}

ChartController.prototype.createOptionList = function (elt, map, namer)
{
  var list = [];
  for (var key in map)
    list.push(namer ? namer(key) : key);
  list.sort(function (a, b) {
    if (a < b)
      return -1;
    if (a > b)
      return 1;
    return 0;
  });

  for (var i = 0; i < list.length; i++) {
    elt.append($('<option></option>', {
      value: list[i],
    }).text(list[i]));
  }
}

ChartController.prototype.getGeneralData = function (callback)
{
  var ready = this.ensureData('general-statistics.json', (function (obj) {
    this.reduce(obj['vendors'], 'Unknown', 0, function(key) {
      return key in VendorMap;
    });
    this.reduce(obj['windows'], 'Other', 0.005, function(key) {
      return WindowsVersionName(key) != 'Unknown';
    });

    // Setup the filter lists.
    //this.createOptionList(this.app.getFilter('fx'), obj['firefox']);
    //this.createOptionList(this.app.getFilter('win'), obj['windows'], WindowsVersionName);
    //this.app.getFilter('fx').val(this.app.getParam('fx', '*'));
    //this.app.getFilter('win').val(this.app.getParam('win', '*'));
    callback();
  }).bind(this));

  return ready;
}

ChartController.prototype.drawGeneral = function ()
{
  var obj = this.getGeneralData(this.drawGeneral.bind(this));
  if (!obj)
    return;

  var samplePercent = (obj.pingFraction * 100).toFixed(1);
  $("#viewport").append(
      $("<p></p>").append(
        $("<strong></strong>").text("Sample size: ")
      ).append(
        $("<span></span>").text(obj.totalPings + " sessions (uniform " + samplePercent + "% of all samples)")
      )
  );

  var elt = this.prepareChartDiv('os-share', 'Operating System Usage', 600, 300);
  var oses = obj['os'];
  this.drawPieChart(elt, [
      { label: "Windows", data: parseInt(oses['Windows']) },
      { label: "Linux", data: parseInt(oses['Linux']) },
      { label: "OS X", data: parseInt(oses['Darwin']) },
  ]);

  var elt = this.prepareChartDiv('fx-share', 'Firefox Version Usage', 600, 300);
  var fx_series = [];
  for (var fxversion in obj['firefox']) {
    fx_series.push({
      label: 'Firefox ' + fxversion,
      data: obj['firefox'][fxversion],
    });
  }
  this.drawPieChart(elt, fx_series);

  var elt = this.prepareChartDiv('vendor-share', 'Device Vendor Usage', 600, 300);
  var vendor_series = [];
  for (var vendor in obj['vendors']) {
    vendor_series.push({
      label: LookupVendor(vendor),
      data: obj['vendors'][vendor],
    });
  }
  this.drawPieChart(elt, vendor_series);

  var elt = this.prepareChartDiv('winver-share', 'Windows Usage', 700, 500);
  var winver_series = [];
  for (var winver in obj['windows']) {
    winver_series.push({
      label: WindowsVersionName(winver),
      data: obj['windows'][winver],
    });
  }
  this.drawPieChart(elt, winver_series);

  var devices_copy = {};
  for (var key in obj['devices'])
    devices_copy[key] = obj['devices'][key];
  this.reduce(devices_copy, 'Other', 0.005, function (key) {
    return key in PCIDeviceMap;
  });

  var elt = this.prepareChartDiv('device-share', 'Devices', 1000, 600);
  var device_series = [];
  for (var device in devices_copy) {
    device_series.push({
      label: PCIDeviceMap[device] || "Other",
      data: devices_copy[device],
    });
  }
  this.drawPieChart(elt, device_series);
}

ChartController.prototype.drawTDRs = function ()
{
  var obj = this.ensureData('tdr-statistics.json', this.drawTDRs.bind(this));
  if (!obj)
    return;

  var totalTDRs = 0;
  for (var i = 0; i < obj.tdrReasons.length; i++)
    totalTDRs += obj.tdrReasons[i];

  var avgUsers = ((obj['tdrPings'] / obj['windowsUsers']) * 100).toFixed(2);
  var avgTDRs = (totalTDRs / obj['tdrPings']).toFixed(1);

  $("#viewport").append(
      $("<p></p>").append(
        $("<strong></strong>").text("Sample size: ")
      ).append(
        $("<span></span>").text(obj.windowsUsers + " sessions")
      ),
      $("<p></p>").append(
        $("<strong></strong>").text("Percentage of sessions with TDRs: ")
      ).append(
        $("<span></span>").text(avgUsers + '%')
      ),
      $("<p></p>").append(
        $("<strong></strong>").text("Average number of TDRs per TDR-affected user: ")
      ).append(
        $("<span></span>").text(avgTDRs)
      )
  );

  var elt = this.prepareChartDiv('tdr-reasons', 'TDR Reason Breakdown', 600, 300);
  var tdrs = [];
  for (var i = 1; i <= DeviceResetReason.length; i++) {
    tdrs.push({
      label: DeviceResetReason[i],
      data: obj.tdrReasons[i],
    });
  }
  this.drawPieChart(elt, tdrs);

  // Combine the TDR breakdown into a single map of vendor => count.
  var combinedMap = {};
  for (var i = 0; i < obj.tdrToVendor.length; i++) {
    var item = obj.tdrToVendor[i];
    var reason = item[0];
    var map = item[1];

    if (!reason || reason > DeviceResetReason.length)
      continue;

    for (var key in map) {
      if (key in combinedMap)
        combinedMap[key] += map[key];
      else
        combinedMap[key] = map[key];
    }
  }

  // Draw the pie chart for the above analysis.
  var elt = this.prepareChartDiv('tdr-vendors', 'TDRs by Vendor', 600, 300);
  var tdrs = [];
  for (var vendor in map) {
    if (!(vendor in VendorMap))
      continue;
    var vendorName = (vendor in VendorMap)
                     ? VendorMap[vendor]
                     : "Unknown vendor " + vendor;
    tdrs.push({
      label: vendorName,
      data: map[vendor],
    });
  }
  this.drawPieChart(elt, tdrs);

  // Draw the vendor -> reason charts.
  for (var i = 0; i < obj.vendorToReason.length; i++) {
    var vendor = obj.vendorToReason[i][0];
    if (!IsMajorVendor(vendor))
      continue;

    var elt = this.prepareChartDiv('tdr-reason-' + vendor, 'TDR Reasons for ' + LookupVendor(vendor), 600, 300);
    var tdrs = [];
    var map = obj.vendorToReason[i][1];
    for (var reason in map) {
      if (!map[reason])
        continue;

      tdrs.push({
        label: DeviceResetReason[reason],
        data: map[reason],
      });
    }
    this.drawPieChart(elt, tdrs);
  }

  // Draw a vendor pie chart for each TDR reason.
  for (var i = 0; i < obj.tdrToVendor.length; i++) {
    var item = obj.tdrToVendor[i];
    var reason = item[0];
    var map = item[1];

    if (!reason || reason > DeviceResetReason.length)
      continue;
    if (Object.keys(map).length == 0)
      continue;

    var elt = this.prepareChartDiv(
        'tdr-reason-' + reason,
        'TDR Reason: ' + DeviceResetReason[reason],
        600, 300);
    var tdrs = [];
    for (var vendor in map) {
      if (!(vendor in VendorMap))
        continue;
      var vendorName = (vendor in VendorMap)
                       ? VendorMap[vendor]
                       : "Unknown vendor " + vendor;
      tdrs.push({
        label: vendorName,
        data: map[vendor],
      });
    }
    this.drawPieChart(elt, tdrs);
  }
}