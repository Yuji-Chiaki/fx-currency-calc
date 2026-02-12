// グローバル変数
let currencyPairs = [];
let exchangeRates = {};
let leverageOptions = [];

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrencyPairs();
  await loadExchangeRates();
  setupEventListeners();
  setupTabs();
});

// 通貨ペア一覧を読み込み
async function loadCurrencyPairs() {
  try {
    const response = await axios.get('/api/currency-pairs');
    if (response.data.success) {
      currencyPairs = response.data.data;
      leverageOptions = response.data.leverageOptions;
      populateCurrencySelects();
      populateLeverageSelect();
    }
  } catch (error) {
    console.error('通貨ペア読み込みエラー:', error);
    showNotification('通貨ペアの読み込みに失敗しました', 'error');
  }
}

// 為替レートを読み込み
async function loadExchangeRates() {
  try {
    const response = await axios.get('/api/exchange-rates');
    if (response.data.success) {
      exchangeRates = response.data.data;
      displayRates();
      updateLastUpdate(response.data.timestamp);
      
      // 1分ごとに自動更新
      setTimeout(loadExchangeRates, 60000);
    }
  } catch (error) {
    console.error('レート読み込みエラー:', error);
  }
}

// レート表示
function displayRates() {
  const container = document.getElementById('ratesContainer');
  container.innerHTML = '';
  
  currencyPairs.forEach(pair => {
    const rate = exchangeRates[pair.code];
    const categoryClass = pair.category === 'high-yield' ? 'bg-yellow-50 border-yellow-300' : 'bg-blue-50 border-blue-300';
    const categoryIcon = pair.category === 'high-yield' ? 'fa-trophy' : 'fa-star';
    
    const card = document.createElement('div');
    card.className = `border-2 ${categoryClass} rounded-lg p-4 hover:shadow-md transition cursor-pointer`;
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-semibold text-gray-700">${pair.name}</span>
        <i class="fas ${categoryIcon} text-xs text-gray-500"></i>
      </div>
      <div class="text-2xl font-bold text-gray-900">${rate ? rate.toFixed(2) : '-'}</div>
      <div class="text-xs text-gray-500 mt-1">${pair.code}</div>
    `;
    container.appendChild(card);
  });
}

// 最終更新時刻表示
function updateLastUpdate(timestamp) {
  const elem = document.getElementById('lastUpdate');
  const date = new Date(timestamp);
  elem.textContent = `最終更新: ${date.toLocaleTimeString('ja-JP')}`;
}

// セレクトボックスに通貨ペアを追加
function populateCurrencySelects() {
  const marginSelect = document.getElementById('marginCurrency');
  const profitSelect = document.getElementById('profitCurrency');
  
  // グループ分け
  const majorPairs = currencyPairs.filter(p => p.category === 'major');
  const highYieldPairs = currencyPairs.filter(p => p.category === 'high-yield');
  
  // 主要通貨ペア
  const majorGroup = document.createElement('optgroup');
  majorGroup.label = '主要通貨ペア';
  majorPairs.forEach(pair => {
    const option = document.createElement('option');
    option.value = pair.code;
    option.textContent = `${pair.name} (${pair.code})`;
    majorGroup.appendChild(option);
  });
  
  // 高金利通貨ペア
  const highYieldGroup = document.createElement('optgroup');
  highYieldGroup.label = '高金利通貨ペア';
  highYieldPairs.forEach(pair => {
    const option = document.createElement('option');
    option.value = pair.code;
    option.textContent = `${pair.name} (${pair.code})`;
    highYieldGroup.appendChild(option);
  });
  
  marginSelect.appendChild(majorGroup.cloneNode(true));
  marginSelect.appendChild(highYieldGroup.cloneNode(true));
  profitSelect.appendChild(majorGroup.cloneNode(true));
  profitSelect.appendChild(highYieldGroup.cloneNode(true));
}

// レバレッジ選択肢を追加
function populateLeverageSelect() {
  const select = document.getElementById('marginLeverage');
  leverageOptions.forEach(leverage => {
    const option = document.createElement('option');
    option.value = leverage;
    option.textContent = `${leverage}倍`;
    select.appendChild(option);
  });
  
  // デフォルトで25倍を選択
  select.value = '25';
}

// イベントリスナー設定
function setupEventListeners() {
  // 証拠金計算フォーム
  document.getElementById('marginForm').addEventListener('submit', calculateMargin);
  document.getElementById('marginCurrency').addEventListener('change', updateMarginRate);
  
  // 損益計算フォーム
  document.getElementById('profitForm').addEventListener('submit', calculateProfit);
}

// タブ切り替え設定
function setupTabs() {
  document.getElementById('tab-margin').addEventListener('click', () => switchTab('margin'));
  document.getElementById('tab-profit').addEventListener('click', () => switchTab('profit'));
}

// タブ切り替え
function switchTab(tab) {
  // タブボタンのスタイル更新
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active', 'border-primary', 'text-primary');
    btn.classList.add('border-transparent', 'text-gray-500');
  });
  
  const activeBtn = document.getElementById(`tab-${tab}`);
  activeBtn.classList.add('active', 'border-primary', 'text-primary');
  activeBtn.classList.remove('border-transparent', 'text-gray-500');
  
  // コンテンツの表示切り替え
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  document.getElementById(`content-${tab}`).classList.remove('hidden');
}

// 証拠金計算時のレート自動入力
function updateMarginRate() {
  const currencyCode = document.getElementById('marginCurrency').value;
  const rateInput = document.getElementById('marginRate');
  
  if (currencyCode && exchangeRates[currencyCode]) {
    rateInput.value = exchangeRates[currencyCode];
  } else {
    rateInput.value = '';
  }
}

// 証拠金計算
async function calculateMargin(e) {
  e.preventDefault();
  
  const currencyPair = document.getElementById('marginCurrency').value;
  const lots = document.getElementById('marginLots').value;
  const leverage = document.getElementById('marginLeverage').value;
  const rate = document.getElementById('marginRate').value;
  const deposit = document.getElementById('marginDeposit').value;
  const lossCutRate = document.getElementById('marginLossCutRate').value;
  
  if (!currencyPair || !lots || !leverage || !rate || !deposit) {
    showNotification('すべての項目を入力してください', 'error');
    return;
  }
  
  try {
    const response = await axios.post('/api/calculate-margin', {
      currencyPair,
      lots,
      leverage,
      rate,
      deposit,
      lossCutRate
    });
    
    if (response.data.success) {
      displayMarginResult(response.data.data);
    } else {
      showNotification(response.data.error, 'error');
    }
  } catch (error) {
    console.error('計算エラー:', error);
    showNotification('計算に失敗しました', 'error');
  }
}

// 証拠金計算結果表示
function displayMarginResult(data) {
  // 基本情報
  document.getElementById('resultMargin').textContent = data.requiredMargin.toLocaleString();
  document.getElementById('resultPosition').textContent = data.positionValue.toLocaleString();
  document.getElementById('resultPipValue').textContent = data.pipValue.toLocaleString();
  
  // リスク管理情報
  document.getElementById('resultEffectiveMargin').textContent = data.effectiveMargin.toLocaleString();
  document.getElementById('resultSurplusMargin').textContent = data.surplusMargin.toLocaleString();
  
  // 証拠金維持率の色分け
  const marginRateElem = document.getElementById('resultMarginRate');
  marginRateElem.textContent = data.marginRate.toLocaleString();
  
  if (data.marginRate < 100) {
    marginRateElem.style.color = '#ef4444'; // 赤色（危険）
  } else if (data.marginRate < 200) {
    marginRateElem.style.color = '#f59e0b'; // オレンジ色（警告）
  } else {
    marginRateElem.style.color = '#10b981'; // 緑色（安全）
  }
  
  // 取引可否
  const canTradeElem = document.getElementById('resultCanTrade');
  if (data.canTrade) {
    canTradeElem.textContent = '✓ 可能';
    canTradeElem.style.color = '#10b981';
  } else {
    canTradeElem.textContent = '✗ 不可';
    canTradeElem.style.color = '#ef4444';
  }
  
  // ロスカット情報
  document.getElementById('resultLossCutPrice').textContent = data.lossCutPrice.toLocaleString();
  document.getElementById('resultPipsToLossCut').textContent = data.pipsToLossCut.toLocaleString();
  
  // 警告メッセージ
  const warningMsg = document.getElementById('warningMessage');
  if (!data.canTrade) {
    warningMsg.classList.remove('hidden');
  } else {
    warningMsg.classList.add('hidden');
  }
  
  document.getElementById('marginResult').classList.remove('hidden');
  
  // スクロール
  document.getElementById('marginResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 損益計算
async function calculateProfit(e) {
  e.preventDefault();
  
  const currencyPair = document.getElementById('profitCurrency').value;
  const lots = document.getElementById('profitLots').value;
  const position = document.getElementById('profitPosition').value;
  const entryRate = document.getElementById('profitEntryRate').value;
  const exitRate = document.getElementById('profitExitRate').value;
  
  if (!currencyPair || !lots || !entryRate || !exitRate) {
    showNotification('すべての項目を入力してください', 'error');
    return;
  }
  
  try {
    const response = await axios.post('/api/calculate-profit', {
      currencyPair,
      lots,
      position,
      entryRate,
      exitRate
    });
    
    if (response.data.success) {
      displayProfitResult(response.data.data);
    } else {
      showNotification(response.data.error, 'error');
    }
  } catch (error) {
    console.error('計算エラー:', error);
    showNotification('計算に失敗しました', 'error');
  }
}

// 損益計算結果表示
function displayProfitResult(data) {
  const profitElem = document.getElementById('resultProfit');
  const pipsElem = document.getElementById('resultPips');
  const percentElem = document.getElementById('resultPercent');
  const profitCard = document.getElementById('profitCard');
  
  // 利益/損失で色を変更
  if (data.profit > 0) {
    profitCard.className = 'bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-lg shadow-lg';
    profitElem.textContent = '+' + data.profit.toLocaleString();
  } else if (data.profit < 0) {
    profitCard.className = 'bg-gradient-to-br from-red-500 to-red-600 text-white p-6 rounded-lg shadow-lg';
    profitElem.textContent = data.profit.toLocaleString();
  } else {
    profitCard.className = 'bg-gradient-to-br from-gray-500 to-gray-600 text-white p-6 rounded-lg shadow-lg';
    profitElem.textContent = '±0';
  }
  
  pipsElem.textContent = data.pips > 0 ? '+' + data.pips : data.pips;
  percentElem.textContent = data.profitPercent > 0 ? '+' + data.profitPercent : data.profitPercent;
  
  document.getElementById('profitResult').classList.remove('hidden');
  
  // スクロール
  document.getElementById('profitResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 通知表示
function showNotification(message, type = 'info') {
  // 簡易的なアラート（本番環境ではtoast通知などを使用）
  const bgColor = type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-blue-500';
  
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// アニメーション用CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }
`;
document.head.appendChild(style);
