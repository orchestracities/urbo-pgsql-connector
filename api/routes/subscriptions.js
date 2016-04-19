var express = require('express');
var router = express.Router();
var request = require('request');
var _ = require('underscore');
var SubscriptionsModel = require('../models/subscriptionsmodel');
var SubscriptionsCartoDBModel = require('../models/subscriptionscartodbmodel');

var logParams = require('../config.js').getLogOpt();
var log = require('log4js').getLogger(logParams.output);
var util = require('util');
var token;
var config;


function getAuthToken(subserv, cb){
  var subservAuth = JSON.parse(JSON.stringify(config.getSubServiceAuth(subserv)));
  var data = {
    'auth': {
      'identity': {
        'methods': [
          'password'
        ],
        'password': {
          'user': {
            'domain': {
             'name': subservAuth.service
            },
           'name': subservAuth.user,
           'password': subservAuth.password
          }
        }
      }
    }
  };

  var options = {
    'url': config.getCtxBrUrls('authtk'),
    'method': 'POST',
    'rejectUnauthorized': false,
    'json': data
  };

  request(options, function (error, response, body) {

    if (!error) {
      var resp = JSON.parse(JSON.stringify(response));
      //log.debug(JSON.stringify(body));
      //log.debug(resp);
      token = resp.headers['x-subject-token'];
      createSubscription(subserv,config);
      cb(null,token);
    }
    else{
      cb(error,null);
    }
  });
}

function createSubscription(sub){

  createTable(sub,function(err){
    if (err)
      return log.error('Cannot create table for subscription');

    registerSubscription(sub);
  });

}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function registerSubscription(sub){

  var cfgData = config.getData();

  model = new SubscriptionsModel(config.getData().pgsql);

  model.getSubscription(sub.id,function(err,d){
    if (err){
      return log.error('Error getting subscription');
    }
    else if (d){
      updateOrionSubscription(sub, cfgData,d.subs_id);
    }
    else{
      setTimeout(function(){
        newOrionSubscription(sub, cfgData);
      },getRandomInt(0,20)*1000);

    }
  });
}

function newOrionSubscription(sub, cfgData){

  var entities =  _.map(sub.entityTypes,function(type){
    return {
      'type': type,
      'isPattern' : 'true',
      'id': '.*'
    };
  });

  var attributes = _.pluck(sub.attributes,'name');

  var srv = config.getSubService(sub.subservice_id);

  log.info('CALLBACK: ' + cfgData.baseURL + '/subscriptions/' + sub.id);

  var data = {
    'entities': entities,
    'attributes': attributes,
    'reference': cfgData.baseURL + '/subscriptions/' + sub.id,
    'duration': 'P1M',
    'notifyConditions': [
        {
            'type': 'ONCHANGE',
            'condValues': attributes
        }
    ],
    'throttling': 'PT0S'
  };

  var headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Fiware-Service': srv.service,
    'Fiware-ServicePath': '/' + srv.subservice,
    'x-auth-token': token
  };

  var options = {
    'url': config.getCtxBrUrls('subscr'),
    'method': 'POST',
    'rejectUnauthorized': false,
    'headers': headers,
    'json': data
  };

  request(options, function (error, response, body) {
    if (!error && response.statusCode == 200) {

      var resp = JSON.parse(JSON.stringify(response));
      var subscritionID = resp.body.subscribeResponse.subscriptionId;
      model = new SubscriptionsModel(config.getData().pgsql);
      model.handleSubscriptionsTable({'subs_id': subscritionID, 'id_name': sub.id},function(err){
        if (err){
          log.error('Error handling subscription');
          return log.error(err);
        }
        getDataLargeSubscriptions(sub, headers, 1000, 20);
      });
      log.info(util.format('New subscription [%s] created successfully',sub.id));
    }
    else{
      log.error(util.format('New subscription [%s] cannot be created',sub.id));
      log.error('Request error: ' + JSON.stringify(response));
    }
  });
}

function getDataLargeSubscriptions(sub, headers, qrylimit, qryoffset){
  var entities =  _.map(sub.entityTypes,function(type){
    return {
      'type': type,
      'isPattern' : 'true',
      'id': '.*'
    };
  });

  var data = {'entities': entities};

  var options = {
    'url': config.getCtxBrUrls('query')+'?details=on&limit='+qrylimit+'&offset='+qryoffset,
    'method': 'POST',
    'rejectUnauthorized': false,
    'headers': headers,
    'json': data
  };

  request(options, function (error, response, body) {
    !response.body.contextResponses
    if (!error && response.statusCode == 200 && response.body.errorCode.code == "200") {

      var resp = JSON.parse(JSON.stringify(response));
      console.log(JSON.stringify(resp.body));

      psqlmodel = new SubscriptionsModel(config.getData().pgsql);

      psqlmodel.storeData(sub,resp.body.contextResponses,config.getData().cartodb);

      var cdbActiveFields = config.cdbActiveFields(sub);
      var cdbActive = config.getData().cartodb.active;
      if (cdbActive && cdbActiveFields){
        cdbmodel = new SubscriptionsCartoDBModel(config.getData().cartodb);
        cdbmodel.storeData(sub,resp.body.contextResponses);
      }

      log.info(util.format('New data added [%s] (>20 entities)',sub.id));

    }
    else{
      log.info(util.format('< 20 entities. No more data added...',sub.id));
      log.info(JSON.parse(JSON.stringify(response)));
    }
  });
}

function updateOrionSubscription(sub, cfgData, subs_id){
    var srv = config.getSubService(sub.subservice_id);

    var data = {
       'subscriptionId': subs_id,
       'duration': 'P1M'
    };

    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Fiware-Service': srv.service,
      'Fiware-ServicePath': '/' + srv.subservice,
      'x-auth-token': token
    }

    var options = {
      'url': config.getCtxBrUrls('updsbscr'),
      'method': 'POST',
      'rejectUnauthorized': false,
      'headers': headers,
      'json': data
    };

    request(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var resp = JSON.parse(JSON.stringify(response));
        log.info(util.format('Updated subscription [%s] completed successfully',sub.id));
      }
      else{
        log.error(util.format('Subscription [%s] cannot be updated',sub.id));
        log.error('Request error: ' + error);
        log.debug(resp);
      }
    });
}

function createSubscriptionCallback(sub){
  log.info('Set router: ' + sub.id);

  router.post('/' + sub.id,function(req,res,next){

    psqlmodel = new SubscriptionsModel(config.getData().pgsql);
    psqlmodel.storeData(sub,req.body.contextResponses,config.getData().cartodb);

    var cdbActiveFields = config.cdbActiveFields(sub);
    var cdbActive = config.getData().cartodb.active;
    if (cdbActive && cdbActiveFields){
      cdbmodel = new SubscriptionsCartoDBModel(config.getData().cartodb);
      cdbmodel.storeData(sub,req.body.contextResponses);
    }
    res.json(req.body);
  });

}

function createTable(sub,cb){
  model = new SubscriptionsModel(config.getData().pgsql);
  model.createTable(sub,function(err){
    if (err){
      log.error('Error creating table');
      return cb(err)
    }
    else{
      log.info('Create table at PostgreSQL completed')
    }

    var cdbActiveFields = config.cdbActiveFields(sub);
    var cdbActive = config.getData().cartodb.active;
    if (cdbActive && cdbActiveFields){
      cdbmodel = new SubscriptionsCartoDBModel(config.getData().cartodb);
      cdbmodel.createTable(sub,function(err){
        if (err)
          log.error('Error creating table at CartoDB');
        else
          log.info('Create table at CartoDB completed');
       });
    }
    else{
      log.info('CartoDB is disabled')
    }
    cb(err)
  });
}

function initialize(cfg,cb){
  config = cfg;

  var subscriptions = config.getSubs();
  for (var i=0;i<subscriptions.length;i++){
    var sub = subscriptions[i];
    getAuthToken(sub, function(error,t){
      if (error){
        log.error('Cannot get access token');
        return log.error(error);
      }
    });
  }

}

function routes(cfg){
  config = cfg;

  var subscriptions = config.getSubs();
  for (var i=0;i<subscriptions.length;i++){
    var sub = subscriptions[i];
    createSubscriptionCallback(sub);
  }

  return router;
}

module.exports.routes = routes;
module.exports.initialize = initialize;
