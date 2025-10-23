require('dotenv').config();
const { Bot, session } = require('grammy');
const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB ga ulandi (Mongoose)');
  } catch (error) {
    console.error('MongoDB ulanish xatosi:', error);
    process.exit(1);
  }
}

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  expenses: [{
    name: String,
    amount: Number,
    category: String,
    date: String,
  }],
  incomes: [{
    source: String,
    amount: Number,
    date: String,
  }],
  limit: { type: Number, default: 0 },
});

const User = mongoose.model('User', userSchema);

function getCurrentDate() {
  return new Date().toISOString().split('T')[0]; 
}

function filterByPeriod(data, period) {
  const now = new Date();
  let startDate;
  if (period === 'weekly') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return data.filter(item => new Date(item.date) >= startDate);
}

async function getUserData(userId) {
  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({ userId, expenses: [], incomes: [], limit: 0 });
    await user.save();
  }
  return user;
}

async function updateUserData(userId, data) {
  await User.findOneAndUpdate({ userId }, data, { upsert: true });
}

const token = process.env.BOT_TOKEN;
const bot = new Bot(token);

const WEBHOOK_PATH = `/webhook/${token}`;
const FULL_WEBHOOK_URL = `${process.env.PUBLIC_URL}${WEBHOOK_PATH}`;

fastify.post(WEBHOOK_PATH, (req, reply) => {
  try {
    bot.processUpdate(req.body); 
    console.log('Update processed:', req.body);
    reply.code(200).send();      
  } catch (error) {
    console.error('Error processing update:', error);
    reply.sendStatus(500);
  }
});


fastify.get('/healthz', (req, reply) => {
  reply.send({ status: 'ok' });
});

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  fastify.log.info(`Server listening at ${address}`);

  try {
const response = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, null, {
  params: { url: FULL_WEBHOOK_URL }
});

    if (response.data.ok) {
      fastify.log.info('Webhook successfully set:', response.data);
    } else {
      fastify.log.error('Failed to set webhook:', response.data);
    }
  } catch (error) {
    fastify.log.error('Error setting webhook:', error.message);
  }
});
bot.getMe().then((botInfo) => {
  bot.me = botInfo;
  console.log(`🤖 Bot ishga tushdi: @${bot.me.username}`);
}).catch((err) => {
  console.error("Bot ma'lumotini olishda xatolik:", err.message);
});

bot.use(session({ initial: () => ({ state: null, tempData: {} }) }));


bot.command('start', (ctx) => {
  ctx.reply('Salom! Men sizning shaxsiy moliyaviy hisob-kitob botingizman. Quyidagi komandalardan foydalaning:\n\n' +
    '/add_expense - Xarajat qo\'shish\n' +
    '/add_income - Daromad qo\'shish\n' +
    '/balance - Balansni ko\'rish\n' +
    '/report weekly - Haftalik hisobot\n' +
    '/report monthly - Oylik hisobot\n' +
    '/set_limit - Xarajat limiti o\'rnatish');
});


bot.command('set_limit', (ctx) => {
  ctx.session.state = 'waiting_limit';
  ctx.reply('Xarajat limiti summasini kiriting (masalan: 1000000):');
});


bot.command('add_expense', (ctx) => {
  ctx.session.state = 'waiting_expense_name';
  ctx.reply('Xarajat nomini kiriting:');
});


bot.command('add_income', (ctx) => {
  ctx.session.state = 'waiting_income_source';
  ctx.reply('Daromad manbasini kiriting (masalan: ish haqi):');
});


bot.command('balance', async (ctx) => {
  const data = await getUserData(ctx.from.id);
  const totalIncome = data.incomes.reduce((sum, i) => sum + i.amount, 0);
  const totalExpense = data.expenses.reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;
  ctx.reply(`Umumiy balans: ${balance} so'm\nDaromad: ${totalIncome} so'm\nXarajat: ${totalExpense} so'm`);
});


bot.command('report', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const period = args[0];
  if (!['weekly', 'monthly'].includes(period)) {
    return ctx.reply('Iltimos, /report weekly yoki /report monthly deb yozing.');
  }

  const data = await getUserData(ctx.from.id);
  const filteredExpenses = filterByPeriod(data.expenses, period);
  const filteredIncomes = filterByPeriod(data.incomes, period);

  const totalIncome = filteredIncomes.reduce((sum, i) => sum + i.amount, 0);
  const totalExpense = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;

  const categoryTotals = {};
  filteredExpenses.forEach(e => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  });
  const categoryReport = Object.entries(categoryTotals).map(([cat, sum]) => `${cat}: ${sum} so'm`).join('\n');

  ctx.reply(`${period === 'weekly' ? 'Haftalik' : 'Oylik'} hisobot:\n\n` +
    `Umumiy daromad: ${totalIncome} so'm\n` +
    `Umumiy xarajat: ${totalExpense} so'm\n` +
    `Sof balans: ${balance} so'm\n\n` +
    `Xarajatlar kategoriyalar bo'yicha:\n${categoryReport || 'Xarajat yo\'q'}`);
});

bot.on('message', async (ctx) => {
  const state = ctx.session.state;
  const userId = ctx.from.id;
  const data = await getUserData(userId);
  const text = ctx.message.text;

  if (state === 'waiting_limit') {
    const limit = parseFloat(text);
    if (isNaN(limit) || limit <= 0) {
      return ctx.reply('Iltimos, musbat raqam kiriting (masalan: 1000000).');
    }
    data.limit = limit;
    await updateUserData(userId, data);
    ctx.session.state = null;
    ctx.reply(`Xarajat limiti ${limit} so'mga o'rnatildi.`);
  } else if (state === 'waiting_expense_name') {
    ctx.session.tempData.name = text;
    ctx.session.state = 'waiting_expense_amount';
    ctx.reply('Xarajat summasini kiriting:');
  } else if (state === 'waiting_expense_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Iltimos, musbat raqam kiriting (masalan: 50000).');
    }
    ctx.session.tempData.amount = amount;
    ctx.session.state = 'waiting_expense_category';
    ctx.reply('Xarajat kategoriyasini kiriting (masalan: oziq-ovqat, transport):');
  } else if (state === 'waiting_expense_category') {
    const expense = {
      name: ctx.session.tempData.name,
      amount: ctx.session.tempData.amount,
      category: text,
      date: getCurrentDate()
    };
    data.expenses.push(expense);
    await updateUserData(userId, data);
    ctx.session.state = null;
    ctx.session.tempData = {};
    const totalExpense = data.expenses.reduce((sum, e) => sum + e.amount, 0);
    if (data.limit > 0 && totalExpense > data.limit) {
      ctx.reply(`⚠️ Eslatma: Sizning umumiy xarajatingiz (${totalExpense} so'm) limiti (${data.limit} so'm) oshib ketdi!`);
    }

    ctx.reply(`Xarajat qo'shildi: ${expense.name} - ${expense.amount} so'm (${expense.category})`);
  } else if (state === 'waiting_income_source') {
    ctx.session.tempData.source = text;
    ctx.session.state = 'waiting_income_amount';
    ctx.reply('Daromad summasini kiriting:');
  } else if (state === 'waiting_income_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Iltimos, musbat raqam kiriting (masalan: 2000000).');
    }
    const income = {
      source: ctx.session.tempData.source,
      amount: amount,
      date: getCurrentDate()
    };
    data.incomes.push(income);
    await updateUserData(userId, data);
    ctx.session.state = null;
    ctx.session.tempData = {};
    ctx.reply(`Daromad qo'shildi: ${income.source} - ${income.amount} so'm`);
  }
});

async function startBot() {
  await connectDB();
  bot.start();
  console.log('Bot ishga tushdi!');
}

startBot();
