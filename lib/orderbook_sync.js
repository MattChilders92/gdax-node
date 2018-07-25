const WebsocketClient = require('./clients/websocket.js');
const AuthenticatedClient = require('./clients/authenticated.js');
const PublicClient = require('./clients/public.js');
const Orderbook = require('./orderbook.js');
const Utils = require('./utilities.js');

// Orderbook syncing
class OrderbookSync extends WebsocketClient {
    constructor(
        productIDs,
        apiURI = 'https://api.gdax.com',
        websocketURI = 'wss://ws-feed.gdax.com',
        auth = null
    ) {
        super(productIDs, websocketURI, auth);
        this.apiURI = apiURI;
        this.auth = Utils.checkAuth(auth);

        this._queues = {}; // []
        this._sequences = {}; // -1
        this.books = {};

        if (this.auth.secret) {
            this._client = new AuthenticatedClient(
                this.auth.key,
                this.auth.secret,
                this.auth.passphrase,
                this.apiURI
            );
        } else {
            this._client = new PublicClient(this.apiURI);
        }

        this.productIDs.forEach(this._newProduct, this);

        this.on('message', this.processMessage.bind(this));
    }

    _newProduct(productID) {
        this._queues[productID] = [];
        this._sequences[productID] = -2;
        this.books[productID] = new Orderbook();
    }

    loadOrderbook(productID) {
        if (!this.books[productID]) {
            return;
        }

        this.emit('sync', productID);

        this._queues[productID] = [];
        this._sequences[productID] = -1;

        const process = data => {
            this.books[productID].state(data);

            this._sequences[productID] = data.sequence;
            this._queues[productID].forEach(this.processMessage, this);
            this._queues[productID] = [];

            this.emit('synced', productID);
        };

        const problems = err => {
            err = err && (err.message || err);
            this.emit('error', new Error('Failed to load orderbook: ' + err));
        };

        this._client
            .getProductOrderBook(productID, { level: 3 })
            .then(process)
            .catch(problems);
    }

    // subscriptions changed -- possible new products
    _newSubscription(data) {
        const channel = data.channels.find(c => c.name === 'full');
        channel &&
        channel.product_ids
            .filter(productID => !(productID in this.books))
    .forEach(this._newProduct, this);
    }

    processMessage(data) {
        const innerData = JSON.parse(data.data);
        const type = innerData.type;
        const product_id = innerData.product_id;

        if (data.type === 'subscriptions') {
            this._newSubscription(data);
            return;
        }

        if (this._sequences[product_id] < 0) {
            // Orderbook snapshot not loaded yet
            this._queues[product_id].push(data);
        }

        if (this._sequences[product_id] === -2) {
            // Start first sync
            this.loadOrderbook(product_id);
            return;
        }

        if (this._sequences[product_id] === -1) {
            // Resync is in process
            return;
        }

        if (innerData.sequence <= this._sequences[product_id]) {
            // Skip this one, since it was already processed
            return;
        }

        if (innerData.sequence !== this._sequences[product_id] + 1) {
            // Dropped a message, start a resync process
            this.loadOrderbook(product_id);
            return;
        }

        this._sequences[product_id] = innerData.sequence;
        const book = this.books[product_id];

        switch (type) {
            case 'open':
                book.add(innerData);
                break;

            case 'done':
                book.remove(innerData.order_id);
                break;

            case 'match':
                book.match(innerData);
                break;

            case 'change':
                book.change(innerData);
                break;
        }
        book.book$.next(book.state());
    }
}

module.exports = exports = OrderbookSync;
