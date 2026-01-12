const Order = require('../../models/orderSchema');
const XLSX = require('xlsx');
const { HttpStatus } = require("../../helpers/status-code");

const getSales = async (req, res) => {
  try {
    const now = new Date();
    let startDate, endDate;

    let reportType = req.query.reportType || 'monthly';

    if (req.query.fromDate && req.query.toDate) {
      startDate = new Date(req.query.fromDate);
      endDate = new Date(req.query.toDate);
      endDate.setHours(23, 59, 59, 999); 
      reportType = 'custom';
    } else if (req.query.quickFilter) {
      const { startDate: qStart, endDate: qEnd } = getQuickFilterDates(req.query.quickFilter);
      startDate = qStart;
      endDate = qEnd;
      reportType = 'custom';
    } else if (req.query.reportType) {
      const { startDate: rStart, endDate: rEnd } = getReportTypeDates(req.query.reportType);
      startDate = rStart;
      endDate = rEnd;
      reportType = req.query.reportType;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      reportType = 'monthly';
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;

    const summaryStats = await calculateSummaryStats(startDate, endDate);

    const salesTrendData = await calculateSalesTrend(startDate, endDate);

    const salesTableData = await getSalesTableData(startDate, endDate, page, limit);

    res.render('sales', {
      summaryStats,
      salesTrendData,
      salesTableData,
      currentPage: page,
      limit,
      fromDate: req.query.fromDate || startDate.toISOString().split('T')[0],
      toDate: req.query.toDate || endDate.toISOString().split('T')[0],
      quickFilter: req.query.quickFilter || '',
      reportType: reportType
    });
  } catch (error) {
    console.log('Error in getSales:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).render('error', { message: 'Internal server error' });
  }
};

const calculateSummaryStats = async (startDate, endDate) => {
  try {
    // Get delivered/successful orders stats
    const successfulOrdersResult = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          orderStatus: { $in: ['Delivered', 'Shipped', 'Processing'] },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSales: { $sum: { $ifNull: ['$total', 0] } },
          totalOfferDiscount: { $sum: { $ifNull: ['$discount', 0] } },
          totalCouponDiscount: { $sum: { $ifNull: ['$couponDiscount', 0] } }
        }
      }
    ]);

    // Get cancelled orders stats
    const cancelledOrdersResult = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          $or: [
            { orderStatus: { $in: ['Cancelled', 'Partially Cancelled'] } },
            { 'items.status': 'Cancelled' }
          ],
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalCancelledOrders: { $sum: 1 },
          totalCancelledValue: { $sum: { $ifNull: ['$total', 0] } }
        }
      }
    ]);

    // Get returned orders stats
    const returnedOrdersResult = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          $or: [
            { orderStatus: { $in: ['Returned', 'Partially Returned'] } },
            { 'items.status': 'Returned' }
          ],
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalReturnedOrders: { $sum: 1 },
          totalReturnedValue: { $sum: { $ifNull: ['$total', 0] } }
        }
      }
    ]);

    const successfulStats = successfulOrdersResult[0] || {
      totalOrders: 0,
      totalSales: 0,
      totalOfferDiscount: 0,
      totalCouponDiscount: 0
    };

    const cancelledStats = cancelledOrdersResult[0] || {
      totalCancelledOrders: 0,
      totalCancelledValue: 0
    };

    const returnedStats = returnedOrdersResult[0] || {
      totalReturnedOrders: 0,
      totalReturnedValue: 0
    };

    const totalDiscounts = successfulStats.totalOfferDiscount + successfulStats.totalCouponDiscount;
    const avgOrderValue = successfulStats.totalOrders > 0 ? successfulStats.totalSales / successfulStats.totalOrders : 0;

    // Calculate net revenue (successful sales - returned value)
    const netRevenue = successfulStats.totalSales - returnedStats.totalReturnedValue;

    return {
      // Successful orders
      totalSales: formatCurrency(successfulStats.totalSales),
      totalOrders: successfulStats.totalOrders.toLocaleString(),
      totalDiscounts: formatCurrency(totalDiscounts),
      avgOrderValue: formatCurrency(avgOrderValue),

      // Cancelled orders
      totalCancelledOrders: cancelledStats.totalCancelledOrders.toLocaleString(),
      totalCancelledValue: formatCurrency(cancelledStats.totalCancelledValue),

      // Returned orders
      totalReturnedOrders: returnedStats.totalReturnedOrders.toLocaleString(),
      totalReturnedValue: formatCurrency(returnedStats.totalReturnedValue),

      // Net revenue
      netRevenue: formatCurrency(netRevenue),

      // Raw values (useful for charts)
      totalSalesRaw: successfulStats.totalSales,
      totalDiscountsRaw: totalDiscounts,
      avgOrderValueRaw: avgOrderValue,
      totalCancelledOrdersRaw: cancelledStats.totalCancelledOrders,
      totalCancelledValueRaw: cancelledStats.totalCancelledValue,
      totalReturnedOrdersRaw: returnedStats.totalReturnedOrders,
      totalReturnedValueRaw: returnedStats.totalReturnedValue,
      netRevenueRaw: netRevenue
    };

  } catch (error) {
    console.error('Error calculating summary stats:', error);
    return {
      totalSales: '₹0',
      totalOrders: '0',
      totalDiscounts: '₹0',
      avgOrderValue: '₹0',
      totalCancelledOrders: '0',
      totalCancelledValue: '₹0',
      totalReturnedOrders: '0',
      totalReturnedValue: '₹0',
      netRevenue: '₹0',
      totalSalesRaw: 0,
      totalDiscountsRaw: 0,
      avgOrderValueRaw: 0,
      totalCancelledOrdersRaw: 0,
      totalCancelledValueRaw: 0,
      totalReturnedOrdersRaw: 0,
      totalReturnedValueRaw: 0,
      netRevenueRaw: 0
    };
  }
};


const getQuickFilterDates = (filter) => {
  const now = new Date();
  let startDate, endDate;

  switch (filter) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'yesterday':
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      break;
    case 'last7days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'last30days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'thismonth':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    case 'lastmonth':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case 'thisyear':
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  }

  return { startDate, endDate };
};

const getReportTypeDates = (reportType) => {
  const now = new Date();
  let startDate, endDate;

  switch (reportType) {
    case 'daily':
      // Today
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'weekly':
      // This week (Monday to Sunday)
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // If Sunday, go back 6 days
      startDate = new Date(now.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'monthly':
      // This month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    case 'yearly':
      // This year
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      break;
    default:
      // Default to current month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  }

  return { startDate, endDate };
};

const calculateSalesTrend = async (startDate, endDate) => {
  try {
    const labels = [];
    const grossSales = [];
    const netSales = [];
    const discounts = [];
    const cancelledSales = [];
    const returnedSales = [];

    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const totalWeeks = Math.max(1, Math.ceil(diffDays / 7));

    for (let week = 0; week < totalWeeks; week++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(startDate.getDate() + (week * 7));

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      if (weekStart > endDate) break;
      if (weekEnd > endDate) weekEnd.setTime(endDate.getTime());

      // Get successful orders
      const weekOrders = await Order.find({
        createdAt: { $gte: weekStart, $lte: weekEnd },
        orderStatus: { $in: ['Delivered', 'Shipped', 'Processing'] },
        isDeleted: false
      });

      // Get cancelled orders
      const weekCancelledOrders = await Order.find({
        createdAt: { $gte: weekStart, $lte: weekEnd },
        $or: [
          { orderStatus: { $in: ['Cancelled', 'Partially Cancelled'] } },
          { 'items.status': 'Cancelled' }
        ],
        isDeleted: false
      });

      // Get returned orders
      const weekReturnedOrders = await Order.find({
        createdAt: { $gte: weekStart, $lte: weekEnd },
        $or: [
          { orderStatus: { $in: ['Returned', 'Partially Returned'] } },
          { 'items.status': 'Returned' }
        ],
        isDeleted: false
      });

      const weekGrossSales = weekOrders.reduce((sum, order) => {
        const gross = (order.total || 0) + (order.discount || 0) + (order.couponDiscount || 0);
        return sum + gross;
      }, 0);

      const weekNetSales = weekOrders.reduce((sum, order) => sum + (order.total || 0), 0);

      const weekDiscounts = weekOrders.reduce((sum, order) => {
        return sum + (order.discount || 0) + (order.couponDiscount || 0);
      }, 0);

      const weekCancelledValue = weekCancelledOrders.reduce((sum, order) => sum + (order.total || 0), 0);
      const weekReturnedValue = weekReturnedOrders.reduce((sum, order) => sum + (order.total || 0), 0);

      labels.push(`Week ${week + 1}`);
      grossSales.push(Math.round(weekGrossSales));
      netSales.push(Math.round(weekNetSales));
      discounts.push(Math.round(weekDiscounts));
      cancelledSales.push(Math.round(weekCancelledValue));
      returnedSales.push(Math.round(weekReturnedValue));
    }

    return {
      labels,
      grossSales,
      netSales,
      discounts,
      cancelledSales,
      returnedSales
    };
  } catch (error) {
    console.error('Error calculating sales trend:', error);
    return {
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
      grossSales: [0, 0, 0, 0, 0],
      netSales: [0, 0, 0, 0, 0],
      discounts: [0, 0, 0, 0, 0],
      cancelledSales: [0, 0, 0, 0, 0],
      returnedSales: [0, 0, 0, 0, 0]
    };
  }
};

const getSalesTableData = async (startDate, endDate, page, limit) => {
  try {
    const skip = (page - 1) * limit;

    // Get all orders (successful, cancelled, and returned)
    const orders = await Order.find({
      createdAt: { $gte: startDate, $lte: endDate },
      orderStatus: { 
        $in: [
          'Delivered', 'Shipped', 'Processing', 'Placed',
          'Cancelled', 'Partially Cancelled',
          'Returned', 'Partially Returned', 'Return Requested'
        ] 
      },
      isDeleted: false
    })
    .populate('user', 'fullName email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const totalOrders = await Order.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
      orderStatus: { 
        $in: [
          'Delivered', 'Shipped', 'Processing', 'Placed',
          'Cancelled', 'Partially Cancelled',
          'Returned', 'Partially Returned', 'Return Requested'
        ] 
      },
      isDeleted: false
    });

    const formattedOrders = orders.map(order => {
      const grossAmount = (order.total || 0) + (order.discount || 0) + (order.couponDiscount || 0);
      const totalDiscount = (order.discount || 0) + (order.couponDiscount || 0);

      const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);

      // Count cancelled and returned items
      const cancelledItems = order.items.filter(item => item.status === 'Cancelled').length;
      const returnedItems = order.items.filter(item => item.status === 'Returned').length;

      let statusBadge = '';
      let orderType = 'successful'; // successful, cancelled, returned

      switch (order.orderStatus) {
        case 'Delivered':
          statusBadge = '<span class="badge bg-success">Delivered</span>';
          orderType = 'successful';
          break;
        case 'Shipped':
          statusBadge = '<span class="badge bg-info">Shipped</span>';
          orderType = 'successful';
          break;
        case 'Processing':
          statusBadge = '<span class="badge bg-warning text-dark">Processing</span>';
          orderType = 'successful';
          break;
        case 'Placed':
          statusBadge = '<span class="badge bg-primary">Placed</span>';
          orderType = 'successful';
          break;
        case 'Cancelled':
          statusBadge = '<span class="badge bg-danger">Cancelled</span>';
          orderType = 'cancelled';
          break;
        case 'Partially Cancelled':
          statusBadge = '<span class="badge bg-warning">Partially Cancelled</span>';
          orderType = 'cancelled';
          break;
        case 'Returned':
          statusBadge = '<span class="badge bg-secondary">Returned</span>';
          orderType = 'returned';
          break;
        case 'Partially Returned':
          statusBadge = '<span class="badge bg-info">Partially Returned</span>';
          orderType = 'returned';
          break;
        case 'Return Requested':
          statusBadge = '<span class="badge bg-warning">Return Requested</span>';
          orderType = 'returned';
          break;
        default:
          statusBadge = '<span class="badge bg-secondary">Unknown</span>';
          orderType = 'successful';
      }

      // Add additional info for cancelled/returned orders
      let additionalInfo = '';
      if (order.orderStatus.includes('Cancelled') && order.cancellationReason) {
        additionalInfo = `Reason: ${order.cancellationReason}`;
      } else if (order.orderStatus.includes('Return') && order.returnReason) {
        additionalInfo = `Reason: ${order.returnReason}`;
      }

      // Calculate refund amount for returned orders
      let refundAmount = 0;
      if (orderType === 'returned' && (order.paymentStatus === 'Refunded' || order.paymentStatus === 'Partially Refunded')) {
        refundAmount = order.total; // Simplified - in real scenario, calculate based on returned items
      }

      return {
        date: order.createdAt.toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }),
        orderNumber: order.orderNumber,
        customerName: order.user?.fullName || 'Guest',
        totalItems,
        cancelledItems,
        returnedItems,
        grossAmount: formatCurrency(grossAmount),
        discount: formatCurrency(totalDiscount),
        couponCode: order.couponCode || '-',
        netAmount: formatCurrency(order.total),
        refundAmount: refundAmount > 0 ? formatCurrency(refundAmount) : '-',
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        status: statusBadge,
        orderType,
        additionalInfo,
        grossAmountRaw: grossAmount,
        discountRaw: totalDiscount,
        netAmountRaw: order.total,
        refundAmountRaw: refundAmount
      };
    });

    const totalPages = Math.ceil(totalOrders / limit);
    const showingStart = skip + 1;
    const showingEnd = Math.min(skip + limit, totalOrders);

    return {
      orders: formattedOrders,
      pagination: {
        currentPage: page,
        totalPages,
        totalOrders,
        showingStart,
        showingEnd,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        nextPage: page + 1,
        prevPage: page - 1
      }
    };
  } catch (error) {
    console.error('Error getting sales table data:', error);
    return {
      orders: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalOrders: 0,
        showingStart: 0,
        showingEnd: 0,
        hasNext: false,
        hasPrev: false,
        nextPage: 1,
        prevPage: 1
      }
    };
  }
};

const formatCurrency = (amount) => {
  return '₹' + Math.round(amount).toLocaleString('en-IN');
};

const exportToExcel = async (req, res) => {
  try {
    const now = new Date();
    let startDate, endDate;

    if (req.query.fromDate && req.query.toDate) {
      startDate = new Date(req.query.fromDate);
      endDate = new Date(req.query.toDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (req.query.quickFilter) {
      const { startDate: qStart, endDate: qEnd } = getQuickFilterDates(req.query.quickFilter);
      startDate = qStart;
      endDate = qEnd;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const salesData = await getSalesTableData(startDate, endDate, 1, 10000);

    const excelData = salesData.orders.map(order => ({
      'Date': order.date,
      'Order Number': order.orderNumber,
      'Customer Name': order.customerName,
      'Order Type': order.orderType.charAt(0).toUpperCase() + order.orderType.slice(1),
      'Total Items': order.totalItems,
      'Cancelled Items': order.cancelledItems || 0,
      'Returned Items': order.returnedItems || 0,
      'Gross Amount': order.grossAmountRaw,
      'Discount': order.discountRaw,
      'Coupon Code': order.couponCode,
      'Net Amount': order.netAmountRaw,
      'Refund Amount': order.refundAmountRaw || 0,
      'Payment Method': order.paymentMethod,
      'Payment Status': order.paymentStatus,
      'Status': order.status.replace(/<[^>]*>/g, ''),
      'Additional Info': order.additionalInfo || ''
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales Report');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `sales-report-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    res.send(buffer);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Failed to export to Excel' });
  }
};

const exportToPDF = async (req, res) => {
  try {
    const now = new Date();
    let startDate, endDate;

    if (req.query.fromDate && req.query.toDate) {
      startDate = new Date(req.query.fromDate);
      endDate = new Date(req.query.toDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (req.query.quickFilter) {
      const { startDate: qStart, endDate: qEnd } = getQuickFilterDates(req.query.quickFilter);
      startDate = qStart;
      endDate = qEnd;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const salesData = await getSalesTableData(startDate, endDate, 1, 10000);
    const summaryStats = await calculateSummaryStats(startDate, endDate);

    const htmlContent = generatePDFHTML(salesData, summaryStats, startDate, endDate);

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Failed to export to PDF' });
  }
};

const generatePDFHTML = (salesData, summaryStats, startDate, endDate) => {
  const formatDate = (date) => date.toLocaleDateString('en-IN');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sales Report</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          background: white;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #4361EE;
          padding-bottom: 20px;
        }
        .summary {
          display: flex;
          justify-content: space-around;
          margin-bottom: 30px;
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
        }
        .summary-item { text-align: center; }
        .summary-value {
          font-size: 24px;
          font-weight: bold;
          color: #4361EE;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
          font-size: 12px;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #4361EE;
          color: white;
          font-weight: bold;
        }
        .status-delivered { color: #28a745; }
        .status-shipped { color: #17a2b8; }
        .status-processing { color: #ffc107; }
        .status-placed { color: #6f42c1; }

        .print-instructions {
          position: fixed;
          top: 10px;
          right: 10px;
          background: #4361EE;
          color: white;
          padding: 15px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          z-index: 1000;
          max-width: 300px;
        }

        .print-btn {
          background: white;
          color: #4361EE;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 10px;
          font-weight: bold;
        }

        @media print {
          .print-instructions { display: none; }
          body { margin: 0; }
          .header { border-bottom: 2px solid #000; }
          th { background-color: #000 !important; color: white !important; }
        }
      </style>
    </head>
    <body>
      <div class="print-instructions">
        <strong>📄 PDF Export Instructions</strong>
        <p>To save as PDF:</p>
        <ol>
          <li>Click "Print to PDF" below</li>
          <li>Or press Ctrl+P (Cmd+P on Mac)</li>
          <li>Select "Save as PDF" as destination</li>
          <li>Click Save</li>
        </ol>
        <button class="print-btn" onclick="window.print()">🖨️ Print to PDF</button>
        <button class="print-btn" onclick="window.close()" style="margin-left: 5px;">✖️ Close</button>
      </div>

      <div class="header">
        <h1>Sales Report</h1>
        <p>Period: ${formatDate(startDate)} to ${formatDate(endDate)}</p>
        <p>Generated on: ${new Date().toLocaleString('en-IN')}</p>
      </div>

      <div class="summary">
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalSales}</div>
          <div>Total Sales</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalOrders}</div>
          <div>Total Orders</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalDiscounts}</div>
          <div>Total Discounts</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.avgOrderValue}</div>
          <div>Avg Order Value</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalCancelledOrders}</div>
          <div>Cancelled Orders</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalCancelledValue}</div>
          <div>Cancelled Value</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalReturnedOrders}</div>
          <div>Returned Orders</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.totalReturnedValue}</div>
          <div>Returned Value</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summaryStats.netRevenue}</div>
          <div>Net Revenue</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Order Number</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Items</th>
            <th>Cancelled</th>
            <th>Returned</th>
            <th>Gross Amount</th>
            <th>Discount</th>
            <th>Coupon</th>
            <th>Net Amount</th>
            <th>Refund</th>
            <th>Payment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${salesData.orders.map(order => `
            <tr>
              <td>${order.date}</td>
              <td>${order.orderNumber}</td>
              <td>${order.customerName}</td>
              <td>${order.orderType.charAt(0).toUpperCase() + order.orderType.slice(1)}</td>
              <td>${order.totalItems}</td>
              <td>${order.cancelledItems || 0}</td>
              <td>${order.returnedItems || 0}</td>
              <td>${order.grossAmount}</td>
              <td>${order.discount}</td>
              <td>${order.couponCode}</td>
              <td>${order.netAmount}</td>
              <td>${order.refundAmount}</td>
              <td>${order.paymentMethod}</td>
              <td>${order.status.replace(/<[^>]*>/g, '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top: 30px; text-align: center; color: #666;">
        <p>Total Records: ${salesData.orders.length}</p>
        <p>Report generated by BookHaven Admin Dashboard</p>
      </div>
    </body>
    </html>
  `;
};

module.exports = {
  getSales,
  exportToExcel,
  exportToPDF
};