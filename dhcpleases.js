#!/usr/bin/node

var fs = require('fs');
var file_config = process.env.CONFIG || '/etc/dhcp/dhcpd.conf';
var file_leases = process.env.LEASES || '/var/lib/dhcp/dhcpd.leases';
var moment = require('moment');
var debug = require('debug')('dhcpleases');
var _ = require('underscore');
var express = require('express');
var app = express();

/*
# The format of this file is documented in the dhcpd.leases(5) manual page.
# This lease file was written by isc-dhcp-4.1.1-P1

lease 172.30.3.189 {
  starts 6 2012/12/01 15:07:57;
  ends 6 2012/12/01 15:08:50;
  tstp 6 2012/12/01 15:08:50;
  cltt 6 2012/12/01 15:07:57;
  binding state free;
  hardware ethernet 64:20:0c:69:75:60;
  uid "\001d \014iu`";
}
*/

var leases = {};
var subnet = {};
var old = {};
var i;

var explodeRange = function (start, finish) {
    var ip1 = start.split(".");
    var ip2 = finish.split(".");

    var range = [];

    var i = ip1;
    while ((parseInt(i[3]) !== parseInt(ip2[3])) ||
           (parseInt(i[2]) !== parseInt(ip2[2])) ||
           (parseInt(i[1]) !== parseInt(ip2[1])) ||
           (parseInt(i[0]) !== parseInt(ip2[0]))) {
        range.push(i.join("."));
        if (i[3] < 255) {
            i[3]++;
        } else if (i[3] === 255 && i[2] < 255) {
            i[3] = 0;
            i[2]++;
        } else if (i[2] === 255 && i[1] < 255) {
            i[3] = 0;
            i[2] = 0;
            i[1]++;
        } else if (i[1] === 255 && i[0] < 255) {
            i[3] = 0;
            i[2] = 0;
            i[1] = 0;
            i[0]++;
        } else {
            throw new Error("Range error: IP out of range");
        }
    }
    range.push(finish);
    return range;
};

var updateFile = function() {
    old.leases = subnet.leases.slice(0); // clone the array
    subnet.leases = [];
    debug("Updated at " + moment().format('MMMM Do YYYY, h:mm:ss a'));
    var i = 0;
    var _active = {},
        _leases = [];

    fs.readFileSync(file_leases).toString().split(/\r?\n/).forEach(function(line){
        if (line.match(/^lease/)) {
            var match = (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/).exec(line);
            _leases[i] = new Object();
            _leases[i].ip = match[0];
        }
        if (line.match(/^  starts/)) {
            var match = (/\d{4}\/\d{2}\/\d{2} \d{2}\:\d{2}\:\d{2}/).exec(line);
            _leases[i].starts = parseInt(moment(match[0] + " Z").format("X"));
        }
        if (line.match(/^  ends/)) {
            if (line.match(/never/)) {
                _leases[i].ends = 2147483647;
            } else {
                var match = (/\d{4}\/\d{2}\/\d{2} \d{2}\:\d{2}\:\d{2}/).exec(line);
                _leases[i].ends = parseInt(moment(match[0] + " Z").format("X"));
            }
        }
        if (line.match(/^  binding state [activefr]+/)) {
            var match = (/active|free/).exec(line);
            _leases[i].state = match[0];
        }
        if (line.match(/^  uid/)) {
            var match = (/".*"/).exec(line);
            _leases[i].uid = match[0].replace(/"/g, '');
        }
        if (line.match(/^  client-hostname/)) {
            var match = (/".*"/).exec(line);
            _leases[i].hostname = match[0].replace(/"/g, '');
        }
        if (line.match(/^  hardware ethernet/)) {
            var match = (/[a-f0-9\:]{17}/).exec(line);
            _leases[i].ethernet = match[0];
        }
        if (line.match(/^}/)) {
            i++;
        }
    });

    for (var i = 0; i < _leases.length; i++) {
        if (_leases[i].state == 'active') {
            _active[_leases[i].ip] = _leases[i];
        }
    }

    // Only count 'active' leases.
    for (var key in _active) {
        subnet.leases.push(_active[key]);
    }
    subnet.meta.used = subnet.leases.length;
    subnet.meta.updated = moment().unix();

    io.sockets.emit("update", subnet.meta);

    if (old.leases !== undefined) {
        // Use .slice(0) to send a COPY of the array, not the reference to the actuall array
        io.sockets.emit("changed", difference(old.leases.slice(0),subnet.leases.slice(0)));
    }
};

var difference = function(original, updated) {
    for (var i = original.length - 1; i >= 0; i--) {
        var delFromOriginal = null;
        for (var j = updated.length - 1; j >= 0; j--) {
            var delFromUpdated = null;
            if (JSON.stringify(original[i]) == JSON.stringify(updated[j])) {
                // JSON.stringify() is not the best, if the lease is out of order
                // (shouldn't be), the JSON will not be equal.
                // In JSON, { a: 1, b:2 } DOES NOT EQUAL { b: 2, a: 1}
                delFromOriginal = i;
                delFromUpdated = j;
            }
            if (delFromUpdated !== null) updated.splice(delFromUpdated,1);
        }
        // We delete from both arrays to make the loop exponentially faster.
        if (delFromOriginal !== null) original.splice(delFromOriginal,1);
    };
    // Return only the updated array's information.
    return updated;
};

fs.readFileSync(file_config).toString().split(/\r?\n/).forEach(function(line){
    if (line.match(/^#/)) return;
    if (line.match(/^\s*subnet/)) {
        i = line.match(/(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
        subnet = { meta: { subnet: i[0], netmask: i[1] }, leases: [] };
    }
    if (line.match(/^\s+range/)) {
        range = line.match(/(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
        subnet.meta.start = range[0];
        subnet.meta.finish = range[1];
        range = explodeRange(range[0], range[1]);
        subnet.meta.total = range.length;
    }
});

var server = app.listen(process.env.PORT || 3412);

var io = require('socket.io').listen(server, { log: false });

updateFile();

fs.watch(file_leases, function(event, filename) {
    updateFile();
});

app.get('/', function(req, res) {
    res.json(subnet);
});

io.on('connection', function(socket){
    socket.emit("init", subnet);
});