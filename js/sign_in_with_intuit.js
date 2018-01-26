var tools = require('./tools.js')
var express = require('express')
var router = express.Router()

/** /sign_in_with_intuit **/
router.get('/', function (req, res) {
    // Set the OpenID scopes
    console.log("Inside sign_in_wih_intuit.js inside home yayyy");

    console.log("The req session is : "+ JSON.stringify(req.session));
    tools.setScopes('sign_in_with_intuit')

    // Constructs the authorization URI.
    var uri = tools.intuitAuth.code.getUri({
        // Add CSRF protection
        state: tools.generateAntiForgery(req.session)
    })

    console.log("After choosing the code flow and adding the CSRF token to the uri , it looks like this :");
    console.log(uri);

    // Redirect
    console.log('Redirecting to authorization uri: ' + uri)
    res.redirect(uri)
})

module.exports = router
