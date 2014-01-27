var validator = require('validator');
var redis = require('redis');
var bcrypt = require('bcrypt');
var crypto = require('crypto');
var fs = require('fs');
var uuid = require('node-uuid');
var settings = require('./settings.js');

var client = redis.createClient(settings.redis.port, settings.redis.ip);
exports.getMetrics = function(req, res) {
    var email = req.query.email;
    if(!validator.isEmail(email)) {
        return res.json(400, {message: 'Invalid email.'});
    }
    client.get(email, function (error, reply) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem getting metrics.'});
        }
        if(!reply) {
            return res.json(400, {message: 'Invalid email.'});
        }
        reply = JSON.parse(reply);
        if(reply.metrics.length === 0) {
            return res.json({metrics: []});
        }
        for(var metricCounter = 0; metricCounter < reply.metrics.length; metricCounter++) {
            reply.metrics[metricCounter].id = 'metric:' + reply.metrics[metricCounter].id;
        }
        client.mget(reply.metrics, function (error, metrics) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem getting metrics.'});
            }
            return res.json({metrics: metrics});
        });
    });
};

exports.getMetric = function(req, res) {
    var metricID = req.query.id;
    if(validator.isNull(metricID)) {
        return res.json(400, {message: 'Missing metric id.'});
    }
    client.get('metric:' + metricID, function (error, metric) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem getting metric.'});
        }
        if(!metric) {
            return res.json(400, {message: 'Metric does not exist.'});
        }
        metric = JSON.parse(metric);
        _getMetricTemplate(metric.id, metric.metrickey, function (error, template) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem getting metric.'});
            }
            return res.json({metric: metric, template: template});
        });
    });
};

exports.createMetric = function(req, res) {
    var email = req.body.email;
    var displayName = req.body.name;
    var displaySuffix = req.body.suffix;
    if(!validator.isEmail(email)) {
        return res.json(400, {message: 'Invalid email.'});
    }
    if(validator.isNull(displayName) || validator.isNull(displaySuffix)) {
        return res.json(400, {message: 'Missing metric elements.'});
    }
    client.get(email, function (error, reply) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem adding the metric.'});
        }
        if(!reply) {
            return res.json(400, {message: 'Invalid email.'});
        }
        reply = JSON.parse(reply);
        var metricID = uuid.v4();
        var metric = {
            id: metricID,
            metrickey: crypto.createHash('sha256').update(metricID).update(settings.crypto.salt).digest('hex'),
            name: displayName,
            suffix: displaySuffix,
            visible: false,
            description: '',
            decimalPlaces: 0,
            axis: {
                y: {
                    min: 0,
                    max: 100,
                    hide: false
                },
                x: {
                    min: 0,
                    max: 100,
                    hide: false  
                }
            },
            data: []
        };
        reply.metrics.push(metricID);
        client.set('metric:' + metricID, JSON.stringify(metric), function(error) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem adding the metric.'});
            }
            client.set(email, JSON.stringify(reply), function (error) {
                if(error) {
                    console.log(error);
                    // Delete the metric we just added, hopefully we can access it :D
                    client.del('metric:' + metricID, function (error) {
                        if(error) {
                            // Shit, we couldn't access it.
                            console.log(error);
                        }
                    });
                    return res.json(500, {message: 'Problem adding the metric.'});
                }
                return res.json({message: 'Metric added.', id: metric.id, metrickey: metric.metrickey});
            });
        });
    });
};

exports.updateMetric = function(req, res) {
    var email = req.body.email;
    delete req.body.email;
    if(!validator.isEmail(email)) {
        return res.json(400, {message: 'Invalid email.'});
    }
    var metric = req.body;
    if(!validator.isNumeric(metric.decimalPlaces) || 
        !validator.isNumeric(metric.axis.x.min) || 
        !validator.isNumeric(metric.axis.x.max) || 
        !validator.isNumeric(metric.axis.y.min) || 
        !validator.isNumeric(metric.axis.y.max) || 
        validator.isNull(metric.name) || 
        validator.isNull(metric.suffix) || 
        validator.isUUID(metric.id, 4)) {
        return res.json(400, {message: 'Invalid metric elements.'});
    }
    _toDataType(metric);
    client.get('metric:' + metric.id, function (error, metric) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem updating the metric.'});
        }
        if(!metric) {
            return res.json(400, {message: 'Invalid email.'});
        }
        metric = JSON.parse(metric);
        var updated = false;
        for(var metricCounter = 0; metricCounter < metric.metrics.length; metricCounter++) {
            if(metric.metrics[metricCounter].id === metric.id) {
                metric.metrics[metricCounter] = metric;
                updated = true;
            }
        }
        if(!updated) {
            res.json(400, {message: 'Metric does not exist.'});
        }
        client.set('metric:' + metric.id, JSON.stringify(metric), function (error) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem updating the metric.'});
            }
            return res.json({message: 'Metric updated.'});
        });
    });
};

exports.deleteMetric = function(req, res) {
    var email = req.body.email;
    var metricID = req.body.id;
    if(!validator.isEmail(email)) {
        return res.json(400, {message: 'Invalid email.'});
    }
    if(validator.isNull(metricID)) {
        return res.json(400, {message: 'Missing metric elements.'});
    }
    client.get(email, function (error, reply) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem deleting the metric.'});
        }
        if(!reply) {
            return res.json(400, {message: 'Invalid email.'});
        }
        reply = JSON.parse(reply);
        var deleted = false;
        for(var metricCounter = 0; metricCounter < reply.metrics.length; metricCounter++) {
            if(reply.metrics[metricCounter] === metricID) {
                reply.metrics.splice(metricCounter, 1);
                deleted = true;
            }
        }
        if(!deleted) {
            return res.json(400, {message: 'Metric does not exist.'});
        }
        client.set(email, JSON.stringify(reply), function (error) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem deleting the metric.'});
            }
            client.del('metric:' + metricID, function (err) {
                if(err) {
                    console.log(err);
                    return res.json(500, {message: 'Problem deleting the metric.'});
                }
                return res.json({message: 'Metric deleted.'});
            });
        });
    });
};

exports.inputMetricData = function(req, res) {
    var metrickey = req.body.metrickey;
    var metricID = req.body.metricID;
    var dhash = req.body.dhash;
    if(typeof(dhash) !== 'object' || !dhash.timeStamp || !dhash.value) {
        return res.json(400, {message: 'Invalid submitted data.'});
    }
    if(!validator.isUUID(metricID, 4)) {
        // TODO may some throttling to prevent bruteforce
        return res.json(400, {message: 'Invalid metric id.'});
    }
    if(validator.isNull(metrickey)) {
        return res.json(400, {message: 'Missing metric key.'});
    }
    client.get('metric:' + metricID, function (error, metric) {
        if(error) {
            console.log(error);
            return res.json(500, {message: 'Problem submitting metric data.'});
        }
        if(!metric) {
            // TODO may some throttling to prevent bruteforce
            return res.json(400, {message: 'Metric does not exist.'});
        }
        metric = JSON.parse(metric);
        if(metric.metrickey !== metrickey) {
            return res.json(400, {message: 'Invalid metric key for this metric.'});
        }
        metric.data.push(dhash);
        client.set('metric:' + metricID, JSON.stringify(metric), function (error) {
            if(error) {
                console.log(error);
                return res.json(500, {message: 'Problem submitting metric data.'});
            }
            return res.json({});
        });
    });
};

function _getMetricTemplate(metricid, metrickey, callback) {
    fs.readFile(__dirname + '/../templates/metricTemplate-js.txt', {encoding: 'utf-8'}, function(error, data) {
        if(error) {
            return callback(error);
        }
        data = data.replace('&metricid&', "'" + metricid + "'");
        data = data.replace('&metrickey&', "'" + metrickey + "'");
        return callback(null, data);
    });
};

/**
 * Traverses JSON object and converts strings and array values to ints, and booleans
 * @param  {object} obj The object to Traverse
 */
function _toDataType(obj) {
    for(var key in obj) {
        if(typeof(obj[key]) === 'object') {
            _toDataType(obj[key]);
        } else if(validator.isInt(obj[key])) {
            obj[key] = parseInt(obj[key], 10);
        } else if(validator.isFloat(obj[key])) {
            obj[key] = parseFloat(obj[key], 10);
        } else if(obj[key] == 'true' || obj[key] == 'false') {
            validator.toBoolean(obj[key]); // strict option available
        } else if(obj[key] instanceof Array) {
            for(var counter = 0; counter < obj[key].length; counter++) {
                _toDataType(obj[counter]);
            }
        }
    }
}