require('dotenv').config();
var https = require('https');
var express = require('express');
var session = require('express-session');
var request = require('request');
var app = express();
var config = require('./config.json');
var path = require('path');
var crypto = require('crypto');
var QuickBooks = require('node-quickbooks');
var queryString = require('query-string');
var fs = require('fs');
var json2csv = require('json2csv');
var Tokens = require('csrf');
var csrf = new Tokens();

// Configure View and Handlebars
app.use(express.static(path.join(__dirname, '')))
app.set('views', path.join(__dirname, 'views'))
var exphbs = require('express-handlebars');
var hbs = exphbs.create({});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.use(session({secret: 'secret', resave: 'false', saveUninitialized: 'false'}))

/*
Create body parsers for application/json and application/x-www-form-urlencoded
 */
var bodyParser = require('body-parser')
app.use(bodyParser.json())
var urlencodedParser = bodyParser.urlencoded({ extended: false })

/*
App Variables
 */
var token_json,realmId,payload;
var fields = ['realmId', 'name', 'id', 'operation', 'lastUpdated'];
var newLine= "\r\n";


app.use(express.static('views'));

app.get('/', function(req, res) {

    //write the headers and newline
    fields= (fields + newLine);

    fs.writeFile('file.csv', fields, function (err, stat) {
        if (err) throw err;
        console.log('file saved');
    });

    // Render home page with params
    res.render('index', {
        redirect_uri: config.redirectUri,
        token_json: token_json,
        webhook_uri: config.webhookUri,
        webhook_payload: payload
    });
});

app.get('/authUri', function(req,res) {

    /*
    Generate csrf Anti Forgery
     */
    req.session.secret = csrf.secretSync();
    var state = csrf.create(req.session.secret);

    /*
    Generate the AuthUrl
     */
    var redirecturl = config.authorization_endpoint +
        '?client_id=' + config.clientId +
        '&redirect_uri=' + encodeURIComponent(config.redirectUri) +  //Make sure this path matches entry in application dashboard
        '&scope='+ config.scopes.connect_to_quickbooks[0] +
        '&response_type=code' +
        '&state=' + state;

    res.send(redirecturl);

});

app.get('/callback', function(req, res) {

    var parsedUri = queryString.parse(req.originalUrl);
    realmId = parsedUri.realmId;

    var auth = (new Buffer(config.clientId + ':' + config.clientSecret).toString('base64'));
    var postBody = {
        url: config.token_endpoint,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + auth,
        },
        form: {
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: config.redirectUri
        }
    };

    request.post(postBody, function (err, res, data) {
        var accessToken = JSON.parse(res.body);
        token_json = JSON.stringify(accessToken, null,2);
    });
    res.send('');

});

app.post('/payload',function (req,res) {


  console.log("The Webhook notification payload is :" + JSON.stringify(req.body));
  res.sendStatus(200);

})

app.post('/webhook', function(req, res) {

    var webhookPayload = JSON.stringify(req.body);
    console.log('The paylopad is :' + JSON.stringify(req.body));
    var signature = req.get('intuit-signature');

    var fields = ['realmId', 'name', 'id', 'operation', 'lastUpdated'];
    var newLine= "\r\n";

    // if signature is empty return 401
    if (!signature) {
        return res.status(401).send('FORBIDDEN');
    }

    // if payload is empty, don't do anything
    if (!webhookPayload) {
        return res.status(200).send('success');
    }

    /**
     * Validates the payload with the intuit-signature hash
     */
    var hash = crypto.createHmac('sha256', config.webhooksVerifier).update(webhookPayload).digest('base64');
    if (signature === hash) {
        console.log("The Webhook notification payload is :" + webhookPayload);

        /**
         * Write the notification to CSV file
         */
        var appendThis = [];
        for(var i=0; i < req.body.eventNotifications.length; i++) {
            var entities = req.body.eventNotifications[i].dataChangeEvent.entities;
            var realmID = req.body.eventNotifications[i].realmId;
            for(var j=0; j < entities.length; j++) {
                var notification = {
                    'realmId': realmID,
                    'name': entities[i].name,
                    'id': entities[i].id,
                    'operation': entities[i].operation,
                    'lastUpdated': entities[i].lastUpdated
                }
                appendThis.push(notification);
            }
        }

        var toCsv = {
            data: appendThis,
            fields: fields
        };

        fs.stat('file.csv', function (err, stat) {
            if (err == null) {
                //write the actual data and end with newline
                var csv = json2csv(toCsv) + newLine;

                fs.appendFile('file.csv', csv, function (err) {
                    if (err) throw err;
                    console.log('The "data to append" was appended to file!');
                });
            }
            else {
                //write the headers and newline
                console.log('New file, just writing headers');
                fields= (fields + newLine);

                fs.writeFile('file.csv', fields, function (err, stat) {
                    if (err) throw err;
                    console.log('file saved');
                });
            }
        });
        return res.status(200).send('SUCCESS');
    }
    return res.status(401).send('FORBIDDEN');
});

app.post('/createCustomer', urlencodedParser, function(req, res) {

    var token = JSON.parse(token_json);

    // save the access token somewhere on behalf of the logged in user
    var qbo = new QuickBooks(config.clientId,
        config.clientSecret,
        token.access_token, /* oAuth access token */
        false, /* no token secret for oAuth 2.0 */
        realmId,
        true, /* use a sandbox account */
        true, /* turn debugging on */
        4, /* minor version */
        '2.0', /* oauth version */
        token.refresh_token /* refresh token */);

    qbo.createCustomer({DisplayName: req.body.displayName}, function(err, customer) {
        if (err) console.log(err)
        else console.log("The response is :" + JSON.stringify(customer,null,2));
        res.send(customer   );
    });

});


// Start server on HTTP (will use ngrok for HTTPS forwarding)
app.listen(8000, function () {
    console.log('Example app listening on port 8000!')
})
