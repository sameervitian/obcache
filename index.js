"use strict";
/*jslint undef: true */

var lru = require('./lru');
var sigmund = require('sigmund');
var log = require('debug')('obcache');
var util = require('util');

function keygen(name,args) {
  var input = { f: name, a: args };
  return sigmund(input,8);
}

function CacheError() {
  Error.captureStackTrace(this, CacheError);
}

util.inherits(CacheError,Error);


var cache = {
  
  Error: CacheError,

  /**
   * ## cache.Create
   *
   * Constructor
   *
   * Creates a new instance with its own LRU Cache
   *
   * @param {Object} Cache Options
   * ```js
   * {
   *  reset: {
   *    interval: 10000, // msec reset interval
   *    firstReset: 1000, // time for first reset (optional)
   *  },
   *  maxAge: 10000 // lru max age
   *  ...
   * }
   *
   * ```
   *
   **/
  Create: function(options) {
    var nextResetTime;
    var anonFnId = 0;
    var store;

    if (options && options.redis) {
      log('creating a redis cache');
      store = require('./redis').init(options);
    } else {
      store = require('./lru').init(options);
    }

    this.store = store;
    this.stats = { hit: 0, miss: 0, reset: 0};

    if (options && options.reset) {
      nextResetTime = options.reset.firstReset || Date.now() + options.reset.interval;
    }
    /**
    *
    * ## cache.wrap
    *
    * @param {Function} function to be wrapped
    * @param {Object} this object for the function being wrapped. Optional
    * @return {Function} Wrapped function that is cache aware
    *
    * Workhorse
    *
    * Given a function, generates a cache aware version of it.
    * The given function must have a callback as its last argument
    *
    **/
    this.wrap = function (fn,thisobj) {
      var stats = this.stats;
      var fname = (fn.name || '_' ) + anonFnId++;
      var cachedfunc;

      log('wrapping function ' + fname);

      cachedfunc = function() {
        var self = thisobj || this;
        var args = Array.prototype.slice.apply(arguments);
        var callback = args.pop();
        var key,data;

        if (typeof callback !== 'function') {
          throw new Error('last argument to ' + fname + ' should be a function');
        }

        if (nextResetTime && (nextResetTime < Date.now())) {
          log('resetting cache ' + nextResetTime);
          store.reset();
          stats.reset++;
          nextResetTime += options.reset.interval;
        }

        key = keygen(fname,args);

        log('fetching from cache ' + key);
        data = store.get(key, onget);

        function onget(err, data) {
          if (!err && data != undefined) {
            log('cache hit' + key);
            process.nextTick(function() {
              callback.call(self,err,data); // found in cache
            });
            stats.hit++;
            return;
          }

          log('cache miss ' + key);

          args.push(function(err,res) {
            if (!err) {
              log('saving key ' + key);
              store.set(key,res);
            }

            if (err && (err instanceof CacheError)) {
              log('skipping from cache, overwriting error');
              err = undefined;
            } 
            callback.call(self,err,res);
          });

          fn.apply(self,args);
          return stats.miss++;
        }

      };
      log('created new cache function with name ' + fname);
      cachedfunc.cacheName = fname;
      return cachedfunc;
    };


    /* first argument is the function, last is the value */
    this.warmup = function() {
      var args = Array.prototype.slice.apply(arguments);
      var func = args.shift();
      var res = args.pop();
      var fname,key;

      if (!func || typeof(func) != 'function' || !func.cacheName) {
        throw new Error('Not a obcache function');
      }

      fname = func.cacheName;
      key = keygen(fname,args);
      log('warming up cache for ' + fname + ' with key ' + key);
      store.set(key,res);
    };

    this.invalidate = function() {
      var args = Array.prototype.slice.apply(arguments);
      var func = args.shift();
      var res = args.pop();
      var fname,key;

      if (!func || typeof(func) != 'function' || !func.cacheName) {
        throw new Error('Not a obcache function');
      }

      fname = func.cacheName;
      key = keygen(fname,args);
      log('warming up cache for ' + fname + ' with key ' + key);
      store.expire(key);
    }

  },

  debug: require('./debug')
};

module.exports = cache;
