#!/usr/bin/node

var fs = require('fs');
var file_config = '/etc/dhcpd/dhcpd.conf';
var file_leases = '/var/lib/dhcpd/dhcpd.leases';
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

function printTable() {
    var debug = require('debug')('dhcpleases');
    var moment = require('moment');
    debug("Updated at " + moment().format('MMMM Do YYYY, h:mm:ss a'));
    var cliTable = require('cli-table');
    var table = new cliTable({
        head: ['IP Address', 'State', 'Ethernet']
    });
    for (var lease in leases) {
        table.push([leases[lease].ip, leases[lease].state, leases[lease].ethernet]);
    }
    console.log(table.toString());
}

function updateFile() {
    debug("Updated at " + moment().format('MMMM Do YYYY, h:mm:ss a'));
    var i = 0;
    var _active = {},
    _leases = [];

    fs.readFileSync(file).toString().split(/\r?\n/).forEach(function(line){
        if (line.match(/^lease/)) {
            var match = (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/).exec(line);
            _leases[i] = new Object();
            _leases[i].ip = match[0];
        }
        if (line.match(/^  starts/)) {
            var match = (/\d{4}\/\d{2}\/\d{2} \d{2}\:\d{2}\:\d{2}/).exec(line);
            _leases[i].starts = match[0];
        }
        if (line.match(/^  ends/)) {
            var match = (/\d{4}\/\d{2}\/\d{2} \d{2}\:\d{2}\:\d{2}/).exec(line);
            _leases[i].ends = match[0];
        }
        if (line.match(/^  binding state/)) {
            var match = (/active|free/).exec(line);
            _leases[i].state = match[0];
        }
        if (line.match(/^  uid/)) {
            var match = (/".*"/).exec(line);
            _leases[i].uid = match[0];
        }
        if (line.match(/^  client-hostname/)) {
            var match = (/".*"/).exec(line);
            _leases[i].hostname = match[0];
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
    leases = _active;
    if (process.env.NODE_ENV === 'development') {
        printTable();
    }
}

fs.watch(file_leases, function(event, filename) {
    updateFile();
});

app.listen(process.env.PORT || 3412);

app.get('/', function(req, res) {
    res.json(leases);
});
