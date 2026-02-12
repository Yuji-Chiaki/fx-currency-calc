import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// 通貨ペアの設定
const CURRENCY_PAIRS = [
  { code: 'USDJPY', name: '米ドル/円', category: 'major', minLot: 0.01, maxLot: 100 },
  { code: 'EURJPY', name: 'ユーロ/円', category: 'major', minLot: 0.01, maxLot: 100 },
  { code: 'GBPJPY', name: '英ポンド/円', category: 'major', minLot: 0.01, maxLot: 100 },
  { code: 'AUDJPY', name: '豪ドル/円', category: 'major', minLot: 0.01, maxLot: 100 },
  { code: 'TRYJPY', name: 'トルコリラ/円', category: 'high-yield', minLot: 0.01, maxLot: 100 },
  { code: 'MXNJPY', name: 'メキシコペソ/円', category: 'high-yield', minLot: 0.01, maxLot: 100 },
  { code: 'ZARJPY', name: '南アフリカランド/円', category: 'high-yield', minLot: 0.01, maxLot: 100 }
]

// レバレッジオプション
const LEVERAGE_OPTIONS = [1, 10, 25, 50, 100, 200, 400, 500, 888]

// API: 通貨ペア一覧取得
app.get('/api/currency-pairs', (c) => {
  return c.json({ 
    success: true, 
    data: CURRENCY_PAIRS,
    leverageOptions: LEVERAGE_OPTIONS
  })
})

// API: 為替レート取得（Frankfurter API使用）
// レート取得元: Frankfurter API（欧州中央銀行データ）
app.get('/api/exchange-rates', async (c) => {
  try {
    // Frankfurter APIから各通貨ペアのレートを取得
    // 基準通貨ごとに取得してJPY建てレートに変換
    
    // まずJPYベースのレートを取得（USD, EUR, GBP, AUD）
    const mainCurrenciesResponse = await fetch(
      'https://api.frankfurter.app/latest?from=JPY&to=USD,EUR,GBP,AUD,TRY,MXN,ZAR'
    )
    
    if (!mainCurrenciesResponse.ok) {
      throw new Error('Failed to fetch exchange rates')
    }
    
    const mainData = await mainCurrenciesResponse.json()
    
    // JPY建てレートに変換（1/レート = XXX/JPY → JPY/XXX）
    const rates = {
      USDJPY: parseFloat((1 / mainData.rates.USD).toFixed(2)),
      EURJPY: parseFloat((1 / mainData.rates.EUR).toFixed(2)),
      GBPJPY: parseFloat((1 / mainData.rates.GBP).toFixed(2)),
      AUDJPY: parseFloat((1 / mainData.rates.AUD).toFixed(2)),
      TRYJPY: parseFloat((1 / mainData.rates.TRY).toFixed(2)),
      MXNJPY: parseFloat((1 / mainData.rates.MXN).toFixed(2)),
      ZARJPY: parseFloat((1 / mainData.rates.ZAR).toFixed(2))
    }
    
    return c.json({ 
      success: true, 
      data: rates,
      source: 'Frankfurter API (ECB)',
      date: mainData.date,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Exchange rate fetch error:', error)
    
    // フォールバック: エラー時はデモデータを返す
    const fallbackRates = {
      USDJPY: 153.45,
      EURJPY: 165.28,
      GBPJPY: 193.72,
      AUDJPY: 98.65,
      TRYJPY: 4.92,
      MXNJPY: 9.18,
      ZARJPY: 8.35
    }
    
    return c.json({ 
      success: true, 
      data: fallbackRates,
      source: 'フォールバックデータ（参考値）',
      error: 'API取得失敗のためフォールバック',
      timestamp: new Date().toISOString()
    })
  }
})

// API: 証拠金計算
app.post('/api/calculate-margin', async (c) => {
  try {
    const body = await c.req.json()
    const { currencyPair, lots, leverage, rate, deposit, lossCutRate } = body

    // バリデーション
    if (!currencyPair || !lots || !leverage || !rate || !deposit) {
      return c.json({ 
        success: false, 
        error: '必須パラメータが不足しています' 
      }, 400)
    }

    const lotsNum = parseFloat(lots)
    const leverageNum = parseFloat(leverage)
    const rateNum = parseFloat(rate)
    const depositNum = parseFloat(deposit)
    const lossCutRateNum = lossCutRate ? parseFloat(lossCutRate) : 50 // デフォルト50%

    if (isNaN(lotsNum) || isNaN(leverageNum) || isNaN(rateNum) || isNaN(depositNum)) {
      return c.json({ 
        success: false, 
        error: '数値が正しくありません' 
      }, 400)
    }

    if (lotsNum <= 0 || leverageNum <= 0 || rateNum <= 0 || depositNum <= 0) {
      return c.json({ 
        success: false, 
        error: '正の数値を入力してください' 
      }, 400)
    }

    // 証拠金計算
    // 1ロット = 10,000通貨単位（一般的なFX業者の場合）
    const units = lotsNum * 10000
    const positionValue = units * rateNum
    const requiredMargin = positionValue / leverageNum

    // 1pipsの価値計算（JPY建て）
    const pipValue = (units * 0.01)

    // 有効証拠金 = 入金証拠金（含み損益はゼロと仮定）
    const effectiveMargin = depositNum

    // 証拠金維持率 = (有効証拠金 / 必要証拠金) × 100
    const marginRate = (effectiveMargin / requiredMargin) * 100

    // 余剰証拠金 = 有効証拠金 - 必要証拠金
    const surplusMargin = effectiveMargin - requiredMargin

    // ロスカットライン計算
    // ロスカットレート = 現在レート - ((入金証拠金 - 必要証拠金 × ロスカット率) / 取引数量)
    // 買いポジションの場合
    const lossCutThreshold = requiredMargin * (lossCutRateNum / 100)
    const maxLoss = depositNum - lossCutThreshold
    const lossCutPrice = rateNum - (maxLoss / units)

    // ロスカットまでのpips
    const pipsToLossCut = (rateNum - lossCutPrice) * 100

    return c.json({
      success: true,
      data: {
        currencyPair,
        lots: lotsNum,
        leverage: leverageNum,
        rate: rateNum,
        deposit: depositNum,
        units,
        positionValue: Math.round(positionValue),
        requiredMargin: Math.round(requiredMargin),
        effectiveMargin: Math.round(effectiveMargin),
        marginRate: Math.round(marginRate * 100) / 100,
        surplusMargin: Math.round(surplusMargin),
        pipValue: Math.round(pipValue * 100) / 100,
        lossCutRate: lossCutRateNum,
        lossCutPrice: Math.round(lossCutPrice * 100) / 100,
        pipsToLossCut: Math.round(pipsToLossCut * 10) / 10,
        canTrade: surplusMargin >= 0 // 取引可能かどうか
      }
    })
  } catch (error) {
    return c.json({ 
      success: false, 
      error: '計算エラーが発生しました' 
    }, 500)
  }
})

// API: 損益計算
app.post('/api/calculate-profit', async (c) => {
  try {
    const body = await c.req.json()
    const { currencyPair, lots, entryRate, exitRate, position } = body

    if (!currencyPair || !lots || !entryRate || !exitRate || !position) {
      return c.json({ 
        success: false, 
        error: '必須パラメータが不足しています' 
      }, 400)
    }

    const lotsNum = parseFloat(lots)
    const entryRateNum = parseFloat(entryRate)
    const exitRateNum = parseFloat(exitRate)

    if (isNaN(lotsNum) || isNaN(entryRateNum) || isNaN(exitRateNum)) {
      return c.json({ 
        success: false, 
        error: '数値が正しくありません' 
      }, 400)
    }

    const units = lotsNum * 10000
    
    // pips計算
    const priceDiff = exitRateNum - entryRateNum
    const pips = position === 'buy' ? priceDiff * 100 : -priceDiff * 100
    
    // 損益計算（JPY建て）
    const profit = position === 'buy' 
      ? (exitRateNum - entryRateNum) * units
      : (entryRateNum - exitRateNum) * units

    return c.json({
      success: true,
      data: {
        currencyPair,
        lots: lotsNum,
        entryRate: entryRateNum,
        exitRate: exitRateNum,
        position,
        pips: Math.round(pips * 10) / 10,
        profit: Math.round(profit),
        profitPercent: Math.round((pips / entryRateNum) * 10000) / 100
      }
    })
  } catch (error) {
    return c.json({ 
      success: false, 
      error: '計算エラーが発生しました' 
    }, 500)
  }
})

// メインページ
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>FX証拠金計算ツール</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script>
          tailwind.config = {
            theme: {
              extend: {
                colors: {
                  primary: '#3b82f6',
                  secondary: '#1e40af',
                  success: '#10b981',
                  danger: '#ef4444',
                  warning: '#f59e0b'
                }
              }
            }
          }
        </script>
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen">
        <!-- ヘッダー -->
        <header class="bg-white shadow-lg">
            <div class="container mx-auto px-4 py-6">
                <div class="flex items-center justify-between flex-wrap gap-4">
                    <div class="flex items-center space-x-3">
                        <i class="fas fa-chart-line text-4xl text-primary"></i>
                        <div>
                            <h1 class="text-3xl font-bold text-gray-800">FX証拠金計算ツール</h1>
                            <p class="text-sm text-gray-600">必要証拠金と損益をかんたん計算</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <div id="rateSource" class="text-xs text-gray-500 mb-1">
                            <i class="fas fa-database mr-1"></i>レート取得元: 読み込み中...
                        </div>
                        <div id="lastUpdate" class="text-xs text-gray-500">
                            <i class="fas fa-clock mr-1"></i>最終更新: -
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <main class="container mx-auto px-4 py-8">
            <!-- レート表示エリア -->
            <div class="bg-white rounded-lg shadow-lg p-6 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                    <i class="fas fa-exchange-alt mr-2 text-primary"></i>
                    リアルタイムレート
                </h2>
                <div id="ratesContainer" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="text-center p-4 bg-gray-100 rounded animate-pulse">
                        <div class="h-4 bg-gray-300 rounded w-3/4 mx-auto mb-2"></div>
                        <div class="h-6 bg-gray-300 rounded w-1/2 mx-auto"></div>
                    </div>
                </div>
            </div>

            <!-- タブナビゲーション -->
            <div class="bg-white rounded-lg shadow-lg mb-8">
                <div class="border-b border-gray-200">
                    <nav class="flex">
                        <button id="tab-margin" class="tab-btn active px-6 py-4 text-lg font-semibold border-b-4 border-primary text-primary">
                            <i class="fas fa-calculator mr-2"></i>証拠金計算
                        </button>
                        <button id="tab-profit" class="tab-btn px-6 py-4 text-lg font-semibold border-b-4 border-transparent text-gray-500 hover:text-gray-700">
                            <i class="fas fa-chart-bar mr-2"></i>損益シミュレーション
                        </button>
                    </nav>
                </div>

                <!-- 証拠金計算タブ -->
                <div id="content-margin" class="tab-content p-6">
                    <form id="marginForm" class="space-y-6">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- 通貨ペア選択 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-globe mr-1"></i>通貨ペア
                                </label>
                                <select id="marginCurrency" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                                    <option value="">選択してください</option>
                                </select>
                            </div>

                            <!-- ロット数入力 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-layer-group mr-1"></i>ロット数（1ロット=10,000通貨）
                                </label>
                                <input type="number" id="marginLots" step="0.01" min="0.01" placeholder="0.01" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                            </div>

                            <!-- レバレッジ選択 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-balance-scale mr-1"></i>レバレッジ
                                </label>
                                <select id="marginLeverage" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                                    <option value="">選択してください</option>
                                </select>
                            </div>

                            <!-- レート表示 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-yen-sign mr-1"></i>現在レート
                                </label>
                                <input type="number" id="marginRate" step="0.01" readonly class="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50">
                            </div>

                            <!-- 入金証拠金 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-wallet mr-1"></i>入金証拠金（円）
                                </label>
                                <input type="number" id="marginDeposit" step="1000" min="1000" placeholder="100000" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                            </div>

                            <!-- ロスカット率 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-shield-alt mr-1"></i>ロスカット率（%）
                                </label>
                                <select id="marginLossCutRate" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                                    <option value="20">20%（一般的）</option>
                                    <option value="50" selected>50%（国内標準）</option>
                                    <option value="100">100%（厳格）</option>
                                </select>
                            </div>
                        </div>

                        <button type="submit" class="w-full bg-primary hover:bg-secondary text-white font-bold py-4 px-6 rounded-lg transition duration-200 transform hover:scale-105 shadow-lg">
                            <i class="fas fa-calculator mr-2"></i>証拠金を計算する
                        </button>
                    </form>

                    <!-- 計算結果表示 -->
                    <div id="marginResult" class="mt-8 hidden">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">計算結果</h3>
                        
                        <!-- 警告メッセージ -->
                        <div id="warningMessage" class="mb-4 hidden">
                            <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                                <div class="flex">
                                    <i class="fas fa-exclamation-circle text-red-500 mr-3 mt-1"></i>
                                    <div>
                                        <p class="font-bold text-red-800">証拠金不足</p>
                                        <p class="text-sm text-red-700">入金証拠金が必要証拠金を下回っています。取引できません。</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 基本情報 -->
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div class="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">必要証拠金</p>
                                <p class="text-3xl font-bold" id="resultMargin">-</p>
                                <p class="text-sm opacity-90 mt-1">円</p>
                            </div>
                            <div class="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">ポジション総額</p>
                                <p class="text-3xl font-bold" id="resultPosition">-</p>
                                <p class="text-sm opacity-90 mt-1">円</p>
                            </div>
                            <div class="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">1pipsの価値</p>
                                <p class="text-3xl font-bold" id="resultPipValue">-</p>
                                <p class="text-sm opacity-90 mt-1">円</p>
                            </div>
                        </div>

                        <!-- リスク管理情報 -->
                        <h4 class="text-lg font-bold text-gray-800 mb-3">リスク管理</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <div class="bg-white border-2 border-gray-200 p-4 rounded-lg">
                                <p class="text-xs text-gray-600 mb-1">有効証拠金</p>
                                <p class="text-2xl font-bold text-gray-800" id="resultEffectiveMargin">-</p>
                                <p class="text-xs text-gray-500 mt-1">円</p>
                            </div>
                            <div class="bg-white border-2 border-gray-200 p-4 rounded-lg">
                                <p class="text-xs text-gray-600 mb-1">証拠金維持率</p>
                                <p class="text-2xl font-bold" id="resultMarginRate">-</p>
                                <p class="text-xs text-gray-500 mt-1">%</p>
                            </div>
                            <div class="bg-white border-2 border-gray-200 p-4 rounded-lg">
                                <p class="text-xs text-gray-600 mb-1">余剰証拠金</p>
                                <p class="text-2xl font-bold" id="resultSurplusMargin">-</p>
                                <p class="text-xs text-gray-500 mt-1">円</p>
                            </div>
                            <div class="bg-white border-2 border-gray-200 p-4 rounded-lg">
                                <p class="text-xs text-gray-600 mb-1">取引可能</p>
                                <p class="text-2xl font-bold" id="resultCanTrade">-</p>
                            </div>
                        </div>

                        <!-- ロスカット情報 -->
                        <h4 class="text-lg font-bold text-gray-800 mb-3">ロスカット情報</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="bg-gradient-to-br from-red-500 to-red-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">ロスカットレート</p>
                                <p class="text-3xl font-bold" id="resultLossCutPrice">-</p>
                                <p class="text-sm opacity-90 mt-1">円</p>
                            </div>
                            <div class="bg-gradient-to-br from-orange-500 to-orange-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">ロスカットまで</p>
                                <p class="text-3xl font-bold" id="resultPipsToLossCut">-</p>
                                <p class="text-sm opacity-90 mt-1">pips</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 損益シミュレーションタブ -->
                <div id="content-profit" class="tab-content p-6 hidden">
                    <form id="profitForm" class="space-y-6">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- 通貨ペア選択 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-globe mr-1"></i>通貨ペア
                                </label>
                                <select id="profitCurrency" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                                    <option value="">選択してください</option>
                                </select>
                            </div>

                            <!-- ロット数入力 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-layer-group mr-1"></i>ロット数
                                </label>
                                <input type="number" id="profitLots" step="0.01" min="0.01" placeholder="0.01" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                            </div>

                            <!-- ポジション選択 -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-arrows-alt-v mr-1"></i>ポジション
                                </label>
                                <select id="profitPosition" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                                    <option value="buy">買い（ロング）</option>
                                    <option value="sell">売り（ショート）</option>
                                </select>
                            </div>

                            <!-- エントリーレート -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-sign-in-alt mr-1"></i>エントリーレート
                                </label>
                                <input type="number" id="profitEntryRate" step="0.01" placeholder="149.50" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                            </div>

                            <!-- 決済レート -->
                            <div>
                                <label class="block text-sm font-semibold text-gray-700 mb-2">
                                    <i class="fas fa-sign-out-alt mr-1"></i>決済レート
                                </label>
                                <input type="number" id="profitExitRate" step="0.01" placeholder="150.00" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary">
                            </div>
                        </div>

                        <button type="submit" class="w-full bg-success hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 transform hover:scale-105 shadow-lg">
                            <i class="fas fa-chart-line mr-2"></i>損益を計算する
                        </button>
                    </form>

                    <!-- 損益結果表示 -->
                    <div id="profitResult" class="mt-8 hidden">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">シミュレーション結果</h3>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div id="profitCard" class="bg-gradient-to-br text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">損益</p>
                                <p class="text-3xl font-bold" id="resultProfit">-</p>
                                <p class="text-sm opacity-90 mt-1">円</p>
                            </div>
                            <div class="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">pips</p>
                                <p class="text-3xl font-bold" id="resultPips">-</p>
                                <p class="text-sm opacity-90 mt-1">pips</p>
                            </div>
                            <div class="bg-gradient-to-br from-orange-500 to-orange-600 text-white p-6 rounded-lg shadow-lg">
                                <p class="text-sm opacity-90 mb-1">損益率</p>
                                <p class="text-3xl font-bold" id="resultPercent">-</p>
                                <p class="text-sm opacity-90 mt-1">%</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 注意事項 -->
            <div class="bg-yellow-50 border-l-4 border-warning rounded-lg p-6">
                <div class="flex items-start">
                    <i class="fas fa-exclamation-triangle text-warning text-2xl mr-4 mt-1"></i>
                    <div>
                        <h3 class="text-lg font-bold text-gray-800 mb-2">ご注意</h3>
                        <ul class="text-sm text-gray-700 space-y-1">
                            <li>• このツールは教育目的のデモツールです。実際の取引には必ず各FX業者の公式ツールをご利用ください。</li>
                            <li>• 表示されているレートはデモデータです。実際の市場レートとは異なります。</li>
                            <li>• FX取引には高いリスクが伴います。投資は自己責任で行ってください。</li>
                            <li>• 1ロット = 10,000通貨単位で計算しています（業者によって異なる場合があります）。</li>
                        </ul>
                    </div>
                </div>
            </div>
        </main>

        <footer class="bg-gray-800 text-white py-6 mt-12">
            <div class="container mx-auto px-4 text-center">
                <p class="text-sm">&copy; 2024 FX証拠金計算ツール - All Rights Reserved</p>
            </div>
        </footer>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app
