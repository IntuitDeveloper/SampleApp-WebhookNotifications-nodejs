require('dotenv').config();
var https = require('https');
var express = require('express');
var session = require('express-session')
var app = express();
var config = require('./config.json');
var path = require('path');
var crypto = require('crypto');
var QuickBooks = require('node-quickbooks');
var queryString = require('query-string');
var fs = require('fs');
var json2csv = require('json2csv');


// Configure View and Handlebars
app.use(express.static(path.join(__dirname, '')))
app.set('views', path.join(__dirname, 'views'))
var exphbs = require('express-handlebars');
var hbs = exphbs.create({});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.use(session({secret: 'secret', resave: 'false', saveUninitialized: 'false'}))

// Create body parsers for application/json and application/x-www-form-urlencoded
var bodyParser = require('body-parser')
app.use(bodyParser.json())
var urlencodedParser = bodyParser.urlencoded({ extended: false })


var token_json,realmId,payload;

var fields = ['realmId', 'name', 'id', 'operation', 'lastUpdated'];
var newLine= "\r\n";


app.use('/sign_in_with_intuit', require('./js/sign_in_with_intuit.js'));
app.use(express.static('views'));

app.get('/', function(req, res) {

    //write the headers and newline
    console.log('New file, just writing headers');
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

    // Initialize a new version of tools
    var tools = require('./js/tools.js');

    // Set the OpenID scopes
    tools.setScopes('connect_to_quickbooks');

    // Constructs the authorization URI.
    var authorizeUri = tools.intuitAuth.code.getUri({
        // Add CSRF protection
        state: tools.generateAntiForgery(req.session)
    });
    console.log("The auth uri is :"+authorizeUri);
    res.send(authorizeUri);
});

app.get('/callback', function(req, res) {

    var tools = require('./js/tools.js');

    var parsedUri = queryString.parse(req.originalUrl);
    realmId = parsedUri.realmId;

    // Verify anti-forgery
    if(!tools.verifyAntiForgery(req.session, req.query.state)) {
        return res.send('Error - invalid anti-forgery CSRF response!')
    }

    // Exchange auth code for access token
    tools.intuitAuth.code.getToken(req.originalUrl).then(function (token) {
        token_json = JSON.stringify(token.data, null,2);
        res.send('');
    }, function (err) {
        console.log(err)
        res.send(err)
    })

});

app.post('/webhook', function(req, res) {

    var webhookPayload = JSON.stringify(req.body);
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
        res.send(customer);
    });

});



// Start server on HTTP (will use ngrok for HTTPS forwarding)
app.listen(3000, function () {
    console.log('Example app listening on port 3000!')
})
