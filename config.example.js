// Edit this file with the information for your accounts and rename to config.js

var config = {};

config.steam = {};
config.coinbase = {};

config.steam.accountName = ''; // Account name
config.steam.password = ''; // Password
config.coinbase.APIKey = ''; // Coinbase API key
config.price = 1.81; // key price in dollars
config.callback = ''; // The URL Coinbase should ping when it recieves a payment
config.admins = ['']; // Array of the ID64 numbers of the admins (as strings)
config.secret = ""; // random string that only you and Coinbase knows to prevent fake callbacks
config.confirmations = 0; // integer of how many confirmations you require. 0 is recommended, more than 1 is likely not necessary

module.exports = config;
