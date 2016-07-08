var request = require('request');
var config = require('../config.js');
var SubscriptionsModel = require('../models/subscriptionsmodel');
var SubscriptionsCartoDBModel = require('../models/subscriptionscartodbmodel');
var log = require('log4js').getLogger(config.getLogOpt().output);

function getDataPage(sub, headers, page,cb){

  var pageSize = 500;
  var startOffset = 20;

  var offset = pageSize*page + startOffset;

  var entities =  sub.entityTypes.map(function(types){
    return {
      'type': types.typeName,
      'isPattern' : 'true',
      'id': types.typePattern || '.*'
    };
  });

  var data = {'entities': entities};

  var options = {
    'url': config.getCtxBrUrls('query')+'?details=on&limit='+pageSize+'&offset='+offset,
    'method': 'POST',
    'rejectUnauthorized': false,
    'headers': headers,
    'json': data
  };

  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      if (response.body.errorCode.code == "200"){

        psqlmodel = new SubscriptionsModel(config.getData().pgsql);
        psqlmodel.storeData(sub,response.body.contextResponses,config.getData().cartodb);

        var cdbActiveFields = config.cdbActiveFields(sub);
        var cdbActive = config.getData().cartodb.active;
        if (cdbActive && cdbActiveFields){
          cdbmodel = new SubscriptionsCartoDBModel(config.getData().cartodb);
          cdbmodel.storeData(sub,response.body.contextResponses);
        }
        //log.info(util.format('Large subscription (> 20 entities) for [%s]. New data added.',sub.id));
        log.debug('Retrieved paged %d for subscription [%s]',page,sub.id);
        getDataPage(sub, headers, page+1,cb);
      }
      else{
        cb(null);
      }
    }
    else{
      log.error('Request error: ' + error);
      log.debug(response);
      cb(error);
    }
  });
}

function getDataLargeSubscriptions(sub, headers,cb){
  getDataPage(sub,headers,0,cb)
}

module.exports.getDataLargeSubscriptions = getDataLargeSubscriptions;