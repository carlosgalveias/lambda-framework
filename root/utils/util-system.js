'use strict';
const os = require('os');
const utils = {
  sleep: function(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  },
  get: {
    arch: function() {
      return os.arch();
    },
    cpus: function() {
      return os.cpus();
    },
    loadAvg: function() {
      return os.loadavg();
    },
    memoryFree: function() {
      return os.freemem();
    },
    memoryTotal: function() {
      return os.totalmem();
    },
    nanoTime: function() {
      const hrTime = process.hrtime();
      return hrTime[0] * 1000000000 + hrTime[1];
    },
    version: function() {
      return os.version();
    }
  }
};
module.exports = utils;