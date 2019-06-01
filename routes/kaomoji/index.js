var express = require('express');
var crypto = require('crypto');
var qs = require('qs');
var moment = require('moment');
var router = express.Router();
var _ = require('lodash');

var config = require('../../config')();
var slash = require('./slash');
var interaction = require('./interaction');

var UserTokenModel = require('../../models/oauth/userToken');
var kaomojiCommands = require('../../components/commands');

// parse out the user id and verification token
router.use('/slash', (req, res, next) => {
    req.user = req.body.user_id;
    req.token = req.body.token;
    return next();
});

// parse out the user id and verification token
router.use('/interaction', (req, res, next) => {
    req.payload = JSON.parse(req.body.payload);
    if (_.isNil(req.payload)) return res.status(400).send();
    req.user = req.payload.user.id;
    req.token = req.payload.token;
    return next();
})

// check the signature
router.use((req, res, next) => {
    if (!config.SLACK_SIGNING_SECRET) {
        return res.status(500).send('Missing SLACK_SIGNING_SECRET');
    }

    var timestamp = req.header('X-Slack-Request-Timestamp');
    if (moment.unix(timestamp).add(5, 'minutes').isBefore(moment())) {
      // The request timestamp is more than five minutes from local time.
      // It could be a replay attack, so let's ignore it.
      return res.status(401).send('Ignoring old request');
    }

    var body = qs.stringify(req.body, { format:'RFC1738' });
    var sig_basestring = 'v0:' + timestamp + ':' + body;
    var hmac = crypto.createHmac('sha256', config.SLACK_SIGNING_SECRET)
      .update(sig_basestring)
      .digest('hex')
      .toString();

    var my_signature = Buffer.from('v0=' + hmac);
    var received_signature = Buffer.from(req.header('X-Slack-Signature'));
    var valid = crypto.timingSafeEqual(my_signature, received_signature);
    if (!valid) {
        return res.status(401).send('Invalid X-Slack-Signature header');
    }
    return next();
})

// attempt to get the user API token and attach it to the request
router.use((req, res, next) => {
    // try to get a user token
    var UserToken = UserTokenModel(req.db);
    console.log('looking for user token');
    return UserToken.findOne({'user_id': req.user})
        .exec()
        .then(token => {
            if (_.isNil(token)) {
                return res.send(kaomojiCommands.getNoUserTokenText(req.config.SERVER_URL));
            }
            console.log('found user token');
            req.token = token;
            return next();
        });
})

router.use('/slash', slash);

router.use('/interaction', interaction);

module.exports = router;