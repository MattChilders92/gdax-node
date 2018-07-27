const { RBTree } = require('bintrees');
const BigNumber = require('bignumber.js');
const assert = require('assert');
const Rx = require('rxjs');

class Orderbook {
  constructor() {
    this.book$ = new Rx.BehaviorSubject({ asks: [], bids: [] });

    this._ordersByID = {};
    this._bids = new RBTree((a, b) => a.price.comparedTo(b.price));
    this._asks = new RBTree((a, b) => a.price.comparedTo(b.price));
    this.grouping = 8; // 1234.56700000 -> 1230
  }

  _getTree(side) {
    return side === 'buy' ? this._bids : this._asks;
  }

  state(book, limit) {
    limit = limit || 20;
    if (book) {
      this._bids = new RBTree((a, b) => a.price.comparedTo(b.price));
      this._asks = new RBTree((a, b) => a.price.comparedTo(b.price));
      book.bids.forEach(order =>
        this.add({
          id: order[2],
          side: 'buy',
          price: BigNumber(order[0]),
          size: BigNumber(order[1]),
        })
      );

      book.asks.forEach(order =>
        this.add({
          id: order[2],
          side: 'sell',
          price: BigNumber(order[0]),
          size: BigNumber(order[1]),
        })
      );
    } else {
      book = { asks: [], bids: [] };
      this._bids.reach(bid => {
        if (book.bids.length >= limit) {
          return;
        }
        const _order = {
          id: bid.orders[0].id,
          side: bid.orders[0].side,
          price: bid.price,
          size: bid.size,
        };
        return book.bids.push(_order)
      });
      this._asks.each(bid => {
        if (book.asks.length >= limit) {
          return;
        }
        const _order = {
          id: bid.orders[0].id,
          side: bid.orders[0].side,
          price: bid.price,
          size: bid.size,
        };
        return book.asks.push(_order)
      });
      return book;
    }
  }

  get(orderId) {
    return this._ordersByID[orderId];
  }

  add(order) {
    order = {
      id: order.order_id || order.id,
      side: order.side,
      price: BigNumber(order.price),
      size: BigNumber(order.size || order.remaining_size),
    };

    const tree = this._getTree(order.side);
    let treePrice = new BigNumber(order.price).shiftedBy(-1 * this.grouping).dp(8).shiftedBy(this.grouping);
    let node = tree.find({ price: treePrice });

    if (!node) {
      node = {
        price: treePrice,
        orders: [],
        size: order.size
      };
      tree.insert(node);
    } else {
      node.size = node.size.plus(order.size);
    }

    node.orders.push(order);
    this._ordersByID[order.id] = order;
  }

  remove(orderId) {
    const order = this.get(orderId);

    if (!order) {
      return;
    }

    const tree = this._getTree(order.side);
    let treePrice = new BigNumber(order.price).shiftedBy(-1 * this.grouping).dp(8).shiftedBy(this.grouping);
    let node = tree.find({ price: treePrice });
    assert(node);
    const { orders } = node;

    orders.splice(orders.indexOf(order), 1);

    if (orders.length === 0) {
      tree.remove(node);
    }

    delete this._ordersByID[order.id];
  }

  match(match) {
    const size = BigNumber(match.size);
    const price = BigNumber(match.price);
    const tree = this._getTree(match.side);
    let treePrice = new BigNumber(price).shiftedBy(-1 * this.grouping).dp(8).shiftedBy(this.grouping);
    let node = tree.find({ price: treePrice });
    assert(node);

    const order = node.orders.find(order => order.id === match.maker_order_id);

    assert(order);

    order.size = order.size.minus(size);
    this._ordersByID[order.id] = order;

    // assert(order.size >= 0);

    if (order.size.eq(0)) {
      this.remove(order.id);
    }
  }

  change(change) {
    // price of null indicates market order
    if (change.price === null || change.price === undefined) {
      return;
    }

    const size = BigNumber(change.new_size);
    const price = BigNumber(change.price);
    const order = this.get(change.order_id);
    const tree = this._getTree(change.side);
    let treePrice = new BigNumber(price).shiftedBy(-1 * this.grouping).dp(8).shiftedBy(this.grouping);
    let node = tree.find({ price: treePrice });
    if (!node || node.orders.indexOf(order) < 0) {
      console.log('Cant find order to change!');
      return;
    }

    const nodeOrder = node.orders[node.orders.indexOf(order)];

    const newSize = parseFloat(order.size);
    const oldSize = parseFloat(change.old_size);

    assert.equal(oldSize, newSize);

    nodeOrder.size = size;
    this._ordersByID[nodeOrder.id] = nodeOrder;
  }
}

module.exports = exports = Orderbook;
