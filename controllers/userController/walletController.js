const Wallet = require("../../models/walletSchema");
const { calculateRefundAmount, validateRefundForPaymentMethod, calculateExactRefundAmount } = require("../../helpers/money-calculator");


const getWallet = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) {
      return res.redirect('/login');
    }

    
    const page = parseInt(req.query.page) || 1;
    const filter = req.query.filter || 'all';
    const transactionsPerPage = 5;

   
    const wallet = await Wallet.findOne({ userId });

    if (!wallet || !wallet.transactions) {
      return res.render('wallet', {
        wallet: {
          balance: 0,
          transactions: [],
          totalTransactions: 0,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
          filter: filter
        }
      });
    }

    
    let allTransactions = wallet.transactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(transaction => {
        const transactionDate = new Date(transaction.date);

        
        const formattedDate = transactionDate.toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: 'Asia/Kolkata'
        });

        const formattedTime = transactionDate.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata'
        });

        return {
          type: transaction.type,
          amount: transaction.amount.toFixed(2),
          reason: transaction.reason,
          date: formattedDate,
          time: formattedTime,
          fullDateTime: `${formattedDate}, ${formattedTime}`,
          orderId: transaction.orderId
        };
      });

    if (filter !== 'all') {
      allTransactions = allTransactions.filter(transaction => transaction.type === filter);
    }

    const totalTransactions = allTransactions.length;
    const totalPages = Math.ceil(totalTransactions / transactionsPerPage);
    const startIndex = (page - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    const paginatedTransactions = allTransactions.slice(startIndex, endIndex);

    const formattedWallet = {
      balance: wallet.balance,
      transactions: paginatedTransactions,
      totalTransactions: totalTransactions,
      currentPage: page,
      totalPages: totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      filter: filter,
      transactionsPerPage: transactionsPerPage
    };

    res.render('wallet', {
      wallet: formattedWallet
    });
  } catch (error) {
    console.error('Error in getWallet:', error);
    res.status(500).render('error', { message: 'Internal server error' });
  }
};

const processCancelRefund = async (userId, order, productId = null) => {
  try {
    

    if (!userId || !order) {
      console.error('Invalid userId or order for cancel refund');
      return false;
    }

    const existingWallet = await Wallet.findOne({ userId });
    if (existingWallet) {

      let existingRefund;

      if (productId) {
        const itemToCancel = order.items.find(item => 
          item.product?.toString() === productId?.toString() || 
          item._id?.toString() === productId?.toString()
        );

        console.log('Item to cancel:', itemToCancel ? {
          title: itemToCancel.title,
          status: itemToCancel.status,
          finalPrice: itemToCancel.priceBreakdown?.finalPrice || (itemToCancel.discountedPrice * itemToCancel.quantity)
        } : 'NOT FOUND');

        if (itemToCancel) {
          existingRefund = existingWallet.transactions.find(transaction =>
            transaction.orderId?.toString() === order._id.toString() &&
            transaction.type === 'credit' &&
            (transaction.reason.includes(itemToCancel.title) || 
             transaction.reason.includes(productId)) &&
            (transaction.reason.includes('cancelled') || transaction.reason.includes('refund'))
          );
          
          if (existingRefund) {
            return true;
          }
        }
      } else {
        existingRefund = existingWallet.transactions.find(transaction =>
          transaction.orderId?.toString() === order._id.toString() &&
          transaction.type === 'credit' &&
          (transaction.reason.includes('cancelled items in order') ||
           transaction.reason.includes('remaining') ||
           transaction.reason.includes('order #'))
        );
        
        if (existingRefund) {
          return true;
        }
      }
    }
    let refundAmount = 0;
    let refundReason = '';

    if (productId) {
      const itemToCancel = order.items.find(item => 
        item.product?.toString() === productId?.toString() || 
        item._id?.toString() === productId?.toString()
      );

      if (!itemToCancel) {
        return false;
      }

      if (itemToCancel.status === 'Cancelled' || itemToCancel.status === 'Returned') {
        console.log(` Item ${itemToCancel.title} is already ${itemToCancel.status}`);
      }

      refundAmount = calculateExactRefundAmount(itemToCancel, order);
      refundReason = `Refund for cancelled item: ${itemToCancel.title}`;
      
    } else {
      const cancelledItems = order.items.filter(item => 
        item.status === 'Cancelled' || item.status === 'Returned'
      );

      

      if (cancelledItems.length === 0) {
        return true;
      }

      const existingWallet = await Wallet.findOne({ userId });
      const alreadyRefundedItems = [];
      const itemsToRefund = [];

      for (const item of cancelledItems) {
        const existingRefund = existingWallet?.transactions.find(transaction =>
          transaction.orderId?.toString() === order._id.toString() &&
          transaction.type === 'credit' &&
          (transaction.reason.includes(item.title) || 
           transaction.reason.includes(item.product?.toString()) ||
           transaction.reason.includes(item._id?.toString())) &&
          (transaction.reason.includes('cancelled') || transaction.reason.includes('refund'))
        );

        if (existingRefund) {
          alreadyRefundedItems.push({
            title: item.title,
            amount: existingRefund.amount
          });
        } else {
          itemsToRefund.push(item);
        }
      }

      if (itemsToRefund.length === 0) {
        return true;
      }

      for (const item of itemsToRefund) {
        const itemRefund = calculateExactRefundAmount(item, order);
        refundAmount += itemRefund;
      }

      refundReason = `Refund for ${itemsToRefund.length} remaining cancelled item(s) in order`;
      
    }

    if (refundAmount <= 0) {
      return true;
    }

    if (refundAmount > order.total) {
      console.error(` Refund amount (₹${refundAmount.toFixed(2)}) exceeds order total (₹${order.total.toFixed(2)})`);
      console.error('This indicates a calculation error!');
      refundAmount = order.total; 
    }

    const validation = validateRefundForPaymentMethod(order, refundAmount);
    if (!validation.shouldRefund) {
      return true;
    }

    const finalRefundAmount = validation.refundAmount;

    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = new Wallet({
        userId: userId,
        balance: 0,
        transactions: []
      });
    }

    const oldBalance = wallet.balance;
    wallet.balance += finalRefundAmount;

    const newTransaction = {
      type: 'credit',
      amount: finalRefundAmount,
      orderId: order._id,
      reason: refundReason,
      date: new Date()
    };

    wallet.transactions.push(newTransaction);


    await wallet.save();

    return true;

  } catch (error) {
    console.error(' Error processing cancel refund:', error);
    return false;
  }
};





const processReturnRefund = async (userId, order, returnRequestedItems = []) => {
  try {
    if (!userId || !order) {
      console.error('Invalid userId or order for return refund');
      return false;
    }

    

    for (let item of returnRequestedItems) {
      const refundAmount = calculateExactRefundAmount(item, order);
      
      if (refundAmount <= 0) {
        continue;
      }


      const validation = validateRefundForPaymentMethod(order, refundAmount);
      if (!validation.shouldRefund) {
        continue;
      }

      const finalRefundAmount = validation.refundAmount;

      let wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        wallet = new Wallet({
          userId: userId,
          balance: 0,
          transactions: []
        });
      }

      const existingRefund = wallet.transactions.find(transaction =>
        transaction.orderId?.toString() === order._id.toString() &&
        transaction.type === 'credit' &&
        transaction.reason.includes(item.title) &&
        (transaction.reason.includes('returned') || transaction.reason.includes('cancelled'))
      );

      if (existingRefund) {
        continue;
      }

      const oldBalance = wallet.balance;
      wallet.balance += finalRefundAmount;

      const newTransaction = {
        type: 'credit',
        amount: finalRefundAmount,
        orderId: order._id,
        reason: `Refund for returned item: ${item.title}`,
        date: new Date()
      };

      wallet.transactions.push(newTransaction);


      await wallet.save();
    }

    return true;

  } catch (error) {
    console.error('Error processing return refund:', error);
    return false;
  }
};



module.exports = {
    getWallet,
    processCancelRefund,
    processReturnRefund
}