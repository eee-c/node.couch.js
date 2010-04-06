var listener = require('./listener'),
    url = require('url'),
    events = require('events'),
    sys = require('sys'),
    path = require('path'),
    posix = require('fs'),
    http = require('http');

var loadModule = function (content, name, callback) {
  //var p = new events.Promise();
  var wrapper = "(function (exports, require, module, __filename, __dirname) { "
              + content
              + "\n});";
  var exports = {};
  self = this;
  setTimeout( function () {
    // try {
      var compiledWrapper = process.compile(wrapper, name);
      compiledWrapper.apply(exports, [exports, require, self]);
      callback(exports);
      //p.emitSuccess(exports);
    // } catch (e) {
    //   p.emitError(e)
    // }
  }, 0)
  //return p;
}

var alldbs = function (port, hostname, pathname, callback) {
  //var p = new events.Promise();
  var client = http.createClient(port, hostname);
  var request = client.request('GET', pathname + '_all_dbs');
  request.addListener('response', function(response) {
    var buffer = '';
    response.addListener("data", function(data){buffer += data;});
    response.addListener("end", function(){
      dbs = JSON.parse(buffer);
      //p.emitSuccess(dbs);
      callback(dbs);
    });
  });
  request.close();

  //return p;
};

var getDesignDoc = function (baseurl, dbname, id, callback) {
  //var p = new events.Promise();
  var uri = url.parse(baseurl);
  var client = http.createClient(uri.port, uri.hostname)
  var request = client.request('GET', '/'+dbname+'/'+id, {'accept':'application/json'});
  request.addListener('response', function(response){
    var buffer = '';
    response.addListener("data", function(data){buffer += data});
    response.addListener("end", function(){
      dbs = JSON.parse(buffer);
      //p.emitSuccess(dbs);
      callback(dbs);
    })
  })
  request.close();
  //return p;
}

var Deligation = function (baseurl) {
  if (baseurl[baseurl.length - 1] != '/') {
    baseurl += '/';
  }
  this.baseurl = baseurl;
  this.modules = {};
  this.changes = {};
}
Deligation.prototype.designDocChange = function (dbname, id) {
  var d = this;
  if (!this.changes[dbname]) {
    this.changes[dbname] = new listener.Changes(this.baseurl+dbname);
    this.changes[dbname].addListener("change", function(doc) {
      if (doc.id && doc.id.startsWith('_design')) {
        d.designDocChange(dbname, doc.id);
      };
    })
  }

  d.cleanup(dbname, id);
  // getDesignDoc(this.baseurl, dbname, id).addCallback(function(doc){
  //   d.handleDesignDoc(dbname, doc);
  // });
  getDesignDoc(this.baseurl, dbname, id, function(doc){
    d.handleDesignDoc(dbname, doc);
  });
}
Deligation.prototype.handleDesignDoc = function (dbname, doc) {
  var d = this;
  if (doc.changes) {
    loadModule(doc.changes, dbname+'/'+doc._id+'.changes', function(module) {
        if (module.listener) {
          d.changes[dbname].addListener("change", module.listener);
        }
        d.modules[dbname+'/'+doc._id] = module;
    });
      // .addErrback(function() {
      //   sys.puts('Cannot import changes listener from '+JSON.stringify(doc._id));
      // });
  }
};
Deligation.prototype.cleanup = function (dbname, id) {
  var d = this;
  var module = d.modules[dbname+'/'+id];
  if (module) {
    if (module.listener) {
      d.changes[dbname].removeListener("change", module.listener)
    }
    delete module
    delete d.modules[dbname+'/'+id];
  }
}

var getDesignDocs = function (port, hostname, dbpath, callback) {
  //var p = new events.Promise();
  var client = http.createClient(port, hostname);
  var ddocpath = dbpath+'/_all_docs?startkey=%22_design%2F%22&endkey=%22_design0%22';
  var request = client.request('GET', ddocpath, {'accept':'application/json'});
  request.addListener('response', function(response) {
    var buffer = '';
    response.addListener("data", function(data){buffer += data;});
    response.addListener("end", function(){
      var resp = JSON.parse(buffer);
      var docs = [];
      resp.rows.forEach(function(doc) {docs.push(doc)});
      //p.emitSuccess(docs);
      callback(docs);
    });
  });
  request.close();
  //return p;
};

var inArray = function (array, obj) {
  for (i = 0; i < array.length; i+=1) {
    if (array[i] == obj) {
      return true;
    }
  }
  return false;
}

var start = function (couchdbUrl, deligation) {
  var pathname = couchdbUrl.pathname || '/';
  if (pathname[pathname.length - 1] != '/') {
    pathname += '/';
  }
  var href = couchdbUrl.href;
  if (href[href.length - 1] != '/') {
    href += '/';
  }

  finished = [];
  if (!deligation) {
    var deligation = new Deligation(href);
  }

  var attachAllDbs = function (dbs) {
    dbs.forEach(function(dbname) {
      getDesignDocs(couchdbUrl.port, couchdbUrl.hostname, pathname+dbname, function(docs) {
//        .addCallback(function(docs) {
          if (docs.length != 0) {
            docs.forEach(function(doc) {deligation.designDocChange(dbname, doc.id)})
          }
          finished.push(dbname);
          if (finished.length == dbs.length) {
            setInterval(function ()  {
	      alldbs(couchdbUrl.port, couchdbUrl.hostname, pathname, function(dbs) {
                  var newdbs = [];
                  dbs.forEach( function(db) {
                    if (!deligation.changes[db]) { newdbs.push(db) }
                  });
                  attachAllDbs(newdbs);
              })
            }, 60 * 1000);
          }
        })
    })
  }

  // Deprecated promise-based call:
  // alldbs(couchdbUrl.port, couchdbUrl.hostname, pathname).addCallback(attachAllDbs)
  alldbs(couchdbUrl.port, couchdbUrl.hostname, pathname, attachAllDbs)
}

exports.start = start;
exports.Deligation = Deligation;
exports.alldbs = alldbs;
exports.loadModule = loadModule;
exports.getDesignDoc = getDesignDoc;

if (inArray(process.argv, __filename) && process.argv[process.argv.length - 1].startsWith('http')) {
  var couchdbUrl = url.parse(process.argv[process.argv.length - 1]);
  start(couchdbUrl);
}
