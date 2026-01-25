import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Pencil, Search, X, TrendingUp, Bot, Play, Clock, Cpu, Bell, RefreshCw, Wallet, PiggyBank, ArrowUpRight, ArrowDownRight, Building2, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchAPI, type AIService, type NotifyChannel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

interface StockAgentInfo {
  agent_name: string
  schedule: string
  ai_model_id: number | null
  notify_channel_ids: number[]
}

interface Stock {
  id: number
  symbol: string
  name: string
  market: string
  enabled: boolean
  agents: StockAgentInfo[]
}

interface Account {
  id: number
  name: string
  available_funds: number
  enabled: boolean
}

interface Position {
  id: number
  stock_id: number
  symbol: string
  name: string
  market: string
  cost_price: number
  quantity: number
  invested_amount: number | null
  current_price: number | null
  change_pct: number | null
  market_value: number | null
  pnl: number | null
  pnl_pct: number | null
}

interface AccountSummary {
  id: number
  name: string
  available_funds: number
  total_market_value: number
  total_cost: number
  total_pnl: number
  total_pnl_pct: number
  total_assets: number
  positions: Position[]
}

interface PortfolioSummary {
  accounts: AccountSummary[]
  total: {
    total_market_value: number
    total_cost: number
    total_pnl: number
    total_pnl_pct: number
    available_funds: number
    total_assets: number
  }
}

interface AgentConfig {
  name: string
  display_name: string
  description: string
  enabled: boolean
  schedule: string
}

interface SearchResult {
  symbol: string
  name: string
  market: string
}

interface StockForm {
  symbol: string
  name: string
  market: string
}

interface AccountForm {
  name: string
  available_funds: string
}

interface PositionForm {
  account_id: number
  stock_id: number
  cost_price: string
  quantity: string
  invested_amount: string
}

const emptyStockForm: StockForm = { symbol: '', name: '', market: 'CN' }
const emptyAccountForm: AccountForm = { name: '', available_funds: '0' }

export default function StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [services, setServices] = useState<AIService[]>([])
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [loading, setLoading] = useState(true)

  // Portfolio
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set())

  // Quotes for all stocks (used in stock list)
  const [quotes, setQuotes] = useState<Record<string, { current_price: number; change_pct: number }>>({})


  // Stock form
  const [showStockForm, setShowStockForm] = useState(false)
  const [stockForm, setStockForm] = useState<StockForm>(emptyStockForm)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)

  // Account form
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)
  const [editAccountId, setEditAccountId] = useState<number | null>(null)

  // Position form
  const [positionDialogOpen, setPositionDialogOpen] = useState(false)
  const [positionForm, setPositionForm] = useState<PositionForm>({ account_id: 0, stock_id: 0, cost_price: '', quantity: '', invested_amount: '' })
  const [editPositionId, setEditPositionId] = useState<number | null>(null)
  const [positionDialogAccountId, setPositionDialogAccountId] = useState<number | null>(null)

  // Agent dialog
  const [agentDialogStock, setAgentDialogStock] = useState<Stock | null>(null)
  const [triggeringAgent, setTriggeringAgent] = useState<string | null>(null)
  const [scheduleEdits, setScheduleEdits] = useState<Record<string, string>>({})

  const { toast } = useToast()
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    try {
      const [stockData, accountData, agentData, servicesData, channelData] = await Promise.all([
        fetchAPI<Stock[]>('/stocks'),
        fetchAPI<Account[]>('/accounts'),
        fetchAPI<AgentConfig[]>('/agents'),
        fetchAPI<AIService[]>('/providers/services'),
        fetchAPI<NotifyChannel[]>('/channels'),
      ])
      setStocks(stockData)
      setAccounts(accountData)
      setAgents(agentData)
      setServices(servicesData)
      setChannels(channelData)
      // 默认展开所有账户
      setExpandedAccounts(new Set(accountData.map((a: Account) => a.id)))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const loadPortfolio = async () => {
    setPortfolioLoading(true)
    try {
      const [portfolioData, quotesData] = await Promise.all([
        fetchAPI<PortfolioSummary>('/portfolio/summary'),
        fetchAPI<Record<string, { current_price: number; change_pct: number }>>('/stocks/quotes'),
      ])
      setPortfolio(portfolioData)
      setQuotes(quotesData)
    } catch (e) {
      console.error(e)
    } finally {
      setPortfolioLoading(false)
    }
  }

  useEffect(() => { load(); loadPortfolio() }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ========== Stock handlers ==========
  const doSearch = async (q: string) => {
    if (q.length < 1) { setSearchResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const results = await fetchAPI<SearchResult[]>(`/stocks/search?q=${encodeURIComponent(q)}`)
      setSearchResults(results)
      setShowDropdown(results.length > 0)
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }

  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(value), 300)
  }

  const selectStock = (item: SearchResult) => {
    setStockForm({ symbol: item.symbol, name: item.name, market: item.market })
    setSearchQuery(`${item.symbol} ${item.name}`)
    setShowDropdown(false)
  }

  const handleStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetchAPI('/stocks', { method: 'POST', body: JSON.stringify(stockForm) })
    setStockForm(emptyStockForm)
    setSearchQuery('')
    setShowStockForm(false)
    load()
    toast('股票已添加', 'success')
  }

  const handleDeleteStock = async (id: number) => {
    if (!confirm('确定删除？这将同时删除该股票的所有持仓记录')) return
    await fetchAPI(`/stocks/${id}`, { method: 'DELETE' })
    load()
    loadPortfolio()
  }

  const toggleStockEnabled = async (stock: Stock) => {
    await fetchAPI(`/stocks/${stock.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !stock.enabled }) })
    load()
  }

  // ========== Account handlers ==========
  const openAccountDialog = (account?: Account) => {
    if (account) {
      setAccountForm({ name: account.name, available_funds: account.available_funds.toString() })
      setEditAccountId(account.id)
    } else {
      setAccountForm(emptyAccountForm)
      setEditAccountId(null)
    }
    setAccountDialogOpen(true)
  }

  const handleAccountSubmit = async () => {
    const payload = {
      name: accountForm.name,
      available_funds: parseFloat(accountForm.available_funds) || 0,
    }
    if (editAccountId) {
      await fetchAPI(`/accounts/${editAccountId}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await fetchAPI('/accounts', { method: 'POST', body: JSON.stringify(payload) })
    }
    setAccountDialogOpen(false)
    load()
    loadPortfolio()
    toast(editAccountId ? '账户已更新' : '账户已创建', 'success')
  }

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('确定删除该账户？这将同时删除该账户的所有持仓记录')) return
    await fetchAPI(`/accounts/${id}`, { method: 'DELETE' })
    load()
    loadPortfolio()
    toast('账户已删除', 'success')
  }

  // ========== Position handlers ==========
  const openPositionDialog = (accountId: number, position?: Position) => {
    setPositionDialogAccountId(accountId)
    if (position) {
      setPositionForm({
        account_id: accountId,
        stock_id: position.stock_id,
        cost_price: position.cost_price.toString(),
        quantity: position.quantity.toString(),
        invested_amount: position.invested_amount?.toString() || '',
      })
      setEditPositionId(position.id)
    } else {
      setPositionForm({
        account_id: accountId,
        stock_id: 0,
        cost_price: '',
        quantity: '',
        invested_amount: '',
      })
      setEditPositionId(null)
    }
    setPositionDialogOpen(true)
  }

  const handlePositionSubmit = async () => {
    const payload = {
      account_id: positionForm.account_id,
      stock_id: positionForm.stock_id,
      cost_price: parseFloat(positionForm.cost_price),
      quantity: parseInt(positionForm.quantity),
      invested_amount: positionForm.invested_amount ? parseFloat(positionForm.invested_amount) : null,
    }
    if (editPositionId) {
      await fetchAPI(`/positions/${editPositionId}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await fetchAPI('/positions', { method: 'POST', body: JSON.stringify(payload) })
    }
    setPositionDialogOpen(false)
    loadPortfolio()
    toast(editPositionId ? '持仓已更新' : '持仓已添加', 'success')
  }

  const handleDeletePosition = async (id: number) => {
    if (!confirm('确定删除该持仓？')) return
    await fetchAPI(`/positions/${id}`, { method: 'DELETE' })
    loadPortfolio()
    toast('持仓已删除', 'success')
  }

  // ========== Agent handlers ==========
  const toggleAgent = async (stock: Stock, agentName: string) => {
    const current = stock.agents || []
    const isAssigned = current.some(a => a.agent_name === agentName)
    const newAgents = isAssigned
      ? current.filter(a => a.agent_name !== agentName)
      : [...current, { agent_name: agentName, schedule: '', ai_model_id: null, notify_channel_ids: [] }]
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const updateSchedule = async (stock: Stock, agentName: string, schedule: string) => {
    const newAgents = (stock.agents || []).map(a =>
      a.agent_name === agentName ? { ...a, schedule } : a
    )
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const updateStockAgentModel = async (stock: Stock, agentName: string, modelId: number | null) => {
    const newAgents = (stock.agents || []).map(a =>
      a.agent_name === agentName ? { ...a, ai_model_id: modelId } : a
    )
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const toggleStockAgentChannel = async (stock: Stock, agentName: string, channelId: number) => {
    const newAgents = (stock.agents || []).map(a => {
      if (a.agent_name !== agentName) return a
      const current = a.notify_channel_ids || []
      const newIds = current.includes(channelId)
        ? current.filter(id => id !== channelId)
        : [...current, channelId]
      return { ...a, notify_channel_ids: newIds }
    })
    await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
    load()
    setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
  }

  const triggerStockAgent = async (stockId: number, agentName: string) => {
    setTriggeringAgent(agentName)
    try {
      await fetchAPI(`/stocks/${stockId}/agents/${agentName}/trigger`, { method: 'POST' })
      toast('Agent 已触发', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '触发失败', 'error')
    } finally {
      setTriggeringAgent(null)
    }
  }

  // ========== Helpers ==========
  const formatMoney = (value: number) => {
    if (Math.abs(value) >= 10000) {
      return `${(value / 10000).toFixed(2)}万`
    }
    return value.toFixed(2)
  }

  const marketLabel = (m: string) => m === 'CN' ? 'A股' : m === 'HK' ? '港股' : m

  // 保留原始精度显示价格（不强制截断小数位）
  const formatPrice = (value: number) => {
    // 最多显示4位小数，去除末尾的0
    const formatted = value.toFixed(4).replace(/\.?0+$/, '')
    return formatted
  }

  // 获取股票的行情信息
  const getStockQuote = (symbol: string) => {
    return quotes[symbol] || null
  }

  const toggleAccountExpanded = (id: number) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 获取账户中未持有的股票
  const getAvailableStocksForAccount = (accountId: number) => {
    const accountPositions = portfolio?.accounts.find(a => a.id === accountId)?.positions || []
    const heldStockIds = new Set(accountPositions.map(p => p.stock_id))
    return stocks.filter(s => s.enabled && !heldStockIds.has(s.id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">持仓</h1>
          <p className="text-[13px] text-muted-foreground mt-1">管理多账户持仓和监控策略</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadPortfolio} disabled={portfolioLoading}>
            <RefreshCw className={`w-4 h-4 ${portfolioLoading ? 'animate-spin' : ''}`} />
            刷新行情
          </Button>
          <Button variant="secondary" onClick={() => openAccountDialog()}>
            <Building2 className="w-4 h-4" /> 添加账户
          </Button>
          <Button onClick={() => { setStockForm(emptyStockForm); setSearchQuery(''); setShowStockForm(true) }}>
            <Plus className="w-4 h-4" /> 添加股票
          </Button>
        </div>
      </div>

      {/* Portfolio Total Summary */}
      {portfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-[12px]">总市值</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio.total.total_market_value)}
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              {portfolio.total.total_pnl >= 0 ? (
                <ArrowUpRight className="w-4 h-4 text-rose-500" />
              ) : (
                <ArrowDownRight className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-[12px]">总盈亏</span>
            </div>
            <div className={`text-[20px] font-bold font-mono ${portfolio.total.total_pnl >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
              {portfolio.total.total_pnl >= 0 ? '+' : ''}{formatMoney(portfolio.total.total_pnl)}
              <span className="text-[13px] ml-1.5">
                ({portfolio.total.total_pnl_pct >= 0 ? '+' : ''}{portfolio.total.total_pnl_pct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-[12px]">可用资金</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio.total.available_funds)}
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <PiggyBank className="w-4 h-4" />
              <span className="text-[12px]">总资产</span>
            </div>
            <div className="text-[20px] font-bold text-foreground font-mono">
              {formatMoney(portfolio.total.total_assets)}
            </div>
          </div>
        </div>
      )}

      {/* Add Stock Form */}
      {showStockForm && (
        <div className="mb-6 card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[15px] font-semibold text-foreground">添加股票到自选</h3>
            <Button variant="ghost" size="icon" onClick={() => { setShowStockForm(false); setSearchQuery('') }}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <form onSubmit={handleStockSubmit}>
            <div className="relative" ref={dropdownRef}>
              <Label>搜索股票</Label>
              <div className="relative max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <Input
                  value={searchQuery}
                  onChange={e => handleSearchInput(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  placeholder="代码或名称，如 600519 或 茅台"
                  className="pl-10"
                  autoComplete="off"
                />
                {searching && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
              </div>
              {showDropdown && (
                <div className="absolute z-50 w-full max-w-md mt-2 max-h-64 overflow-auto card shadow-lg">
                  {searchResults.map(item => (
                    <button
                      key={`${item.market}-${item.symbol}`}
                      type="button"
                      onClick={() => selectStock(item)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-accent/50 text-left transition-colors"
                    >
                      <span className="font-mono text-muted-foreground text-[12px] w-14">{item.symbol}</span>
                      <span className="flex-1 font-medium text-foreground">{item.name}</span>
                      <Badge variant="secondary">{marketLabel(item.market)}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {stockForm.symbol && (
                <div className="mt-2.5 flex items-center gap-2">
                  <Badge><span className="font-mono">{stockForm.symbol}</span> {stockForm.name}</Badge>
                  <Badge variant="secondary">{marketLabel(stockForm.market)}</Badge>
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center gap-3">
              <Button type="submit" disabled={!stockForm.symbol}>确认添加</Button>
              <Button type="button" variant="ghost" onClick={() => { setShowStockForm(false); setSearchQuery('') }}>取消</Button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts & Positions */}
      {portfolio && portfolio.accounts.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-[hsl(260,70%,55%)]/10 flex items-center justify-center mb-4">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">还没有账户</p>
          <p className="text-[13px] text-muted-foreground mt-1.5">点击"添加账户"创建你的第一个交易账户</p>
        </div>
      ) : (
        <div className="space-y-4">
          {portfolio?.accounts.map(account => (
            <div key={account.id} className="card overflow-hidden">
              {/* Account Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => toggleAccountExpanded(account.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedAccounts.has(account.id) ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Building2 className="w-4 h-4 text-primary" />
                  <span className="text-[15px] font-semibold text-foreground">{account.name}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {account.positions.length} 只持仓
                  </span>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-[11px] text-muted-foreground">市值</div>
                    <div className="text-[13px] font-mono font-medium">{formatMoney(account.total_market_value)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted-foreground">盈亏</div>
                    <div className={`text-[13px] font-mono font-medium ${account.total_pnl >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {account.total_pnl >= 0 ? '+' : ''}{formatMoney(account.total_pnl)}
                      <span className="text-[11px] ml-1">({account.total_pnl_pct >= 0 ? '+' : ''}{account.total_pnl_pct.toFixed(2)}%)</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted-foreground">可用</div>
                    <div className="text-[13px] font-mono">{formatMoney(account.available_funds)}</div>
                  </div>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openPositionDialog(account.id)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openAccountDialog(accounts.find(a => a.id === account.id))}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={() => handleDeleteAccount(account.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Positions Table */}
              {expandedAccounts.has(account.id) && (
                <div className="border-t border-border/30">
                  {account.positions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground text-center py-8">暂无持仓，点击 + 添加</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/30 bg-accent/20">
                          <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted-foreground">股票</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">现价</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">涨跌</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">成本</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">持仓</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">市值</th>
                          <th className="text-right px-4 py-2 text-[11px] font-semibold text-muted-foreground">盈亏</th>
                          <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted-foreground">Agent</th>
                          <th className="text-center px-4 py-2 text-[11px] font-semibold text-muted-foreground">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.positions.map((pos, i) => {
                          const stock = stocks.find(s => s.id === pos.stock_id)
                          const changeColor = pos.change_pct != null
                            ? (pos.change_pct > 0 ? 'text-rose-500' : pos.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground')
                            : 'text-muted-foreground'
                          const pnlColor = pos.pnl != null
                            ? (pos.pnl > 0 ? 'text-rose-500' : pos.pnl < 0 ? 'text-emerald-500' : 'text-muted-foreground')
                            : 'text-muted-foreground'
                          return (
                            <tr key={pos.id} className={`group hover:bg-accent/30 transition-colors ${i > 0 ? 'border-t border-border/20' : ''}`}>
                              <td className="px-4 py-2.5">
                                <span className="font-mono text-[12px] font-semibold text-foreground">{pos.symbol}</span>
                                <span className="ml-1.5 text-[12px] text-muted-foreground">{pos.name}</span>
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono text-[12px] ${changeColor}`}>
                                {pos.current_price?.toFixed(2) ?? '—'}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono text-[12px] ${changeColor}`}>
                                {pos.change_pct != null ? `${pos.change_pct >= 0 ? '+' : ''}${pos.change_pct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
                                {formatPrice(pos.cost_price)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
                                {pos.quantity}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] text-muted-foreground">
                                {pos.market_value != null ? formatMoney(pos.market_value) : '—'}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono text-[12px] ${pnlColor}`}>
                                {pos.pnl != null ? (
                                  <div className="flex flex-col items-end">
                                    <span>{pos.pnl >= 0 ? '+' : ''}{formatMoney(pos.pnl)}</span>
                                    <span className="text-[10px] opacity-70">
                                      {pos.pnl_pct != null ? `${pos.pnl_pct >= 0 ? '+' : ''}${pos.pnl_pct.toFixed(2)}%` : ''}
                                    </span>
                                  </div>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                {stock && (
                                  <button
                                    onClick={() => { setAgentDialogStock(stock); setScheduleEdits({}) }}
                                    className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                                  >
                                    {stock.agents && stock.agents.length > 0 ? (
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {stock.agents.map(sa => {
                                          const agent = agents.find(a => a.name === sa.agent_name)
                                          return (
                                            <Badge key={sa.agent_name} variant="default" className="text-[10px]">
                                              {agent?.display_name || sa.agent_name}
                                            </Badge>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
                                        <Bot className="w-3 h-3" /> 未配置
                                      </span>
                                    )}
                                  </button>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPositionDialog(account.id, pos)}>
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDeletePosition(pos.id)}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stocks without positions (for agent config) */}
      {stocks.filter(s => s.enabled).length > 0 && (
        <div className="mt-6 card p-4">
          <h3 className="text-[13px] font-semibold text-foreground mb-3">自选股列表</h3>
          <div className="flex flex-wrap gap-2">
            {stocks.filter(s => s.enabled).map(stock => {
              const quote = getStockQuote(stock.symbol)
              const changeColor = quote?.change_pct != null
                ? (quote.change_pct > 0 ? 'text-rose-500' : quote.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground')
                : 'text-muted-foreground'
              return (
                <div
                  key={stock.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => { setAgentDialogStock(stock); setScheduleEdits({}) }}
                >
                  <span className="font-mono text-[11px] text-muted-foreground">{stock.symbol}</span>
                  <span className="text-[12px] text-foreground">{stock.name}</span>
                  {quote && (
                    <span className={`font-mono text-[11px] ${changeColor}`}>
                      {quote.current_price?.toFixed(2)}
                      {quote.change_pct != null && (
                        <span className="ml-1">
                          {quote.change_pct >= 0 ? '+' : ''}{quote.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  )}
                  {stock.agents && stock.agents.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">{stock.agents.length} Agent</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-1 hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); handleDeleteStock(stock.id) }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Account Dialog */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editAccountId ? '编辑账户' : '添加账户'}</DialogTitle>
            <DialogDescription>设置交易账户信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>账户名称</Label>
              <Input
                value={accountForm.name}
                onChange={e => setAccountForm({ ...accountForm, name: e.target.value })}
                placeholder="如：招商证券、华泰证券"
              />
            </div>
            <div>
              <Label>可用资金（元）</Label>
              <Input
                value={accountForm.available_funds}
                onChange={e => setAccountForm({ ...accountForm, available_funds: e.target.value })}
                placeholder="0"
                className="font-mono"
                inputMode="decimal"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setAccountDialogOpen(false)}>取消</Button>
              <Button onClick={handleAccountSubmit} disabled={!accountForm.name}>
                {editAccountId ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Position Dialog */}
      <Dialog open={positionDialogOpen} onOpenChange={setPositionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editPositionId ? '编辑持仓' : '添加持仓'}</DialogTitle>
            <DialogDescription>
              {accounts.find(a => a.id === positionDialogAccountId)?.name} 账户持仓
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {!editPositionId && (
              <div>
                <Label>选择股票</Label>
                <Select
                  value={positionForm.stock_id.toString()}
                  onValueChange={val => setPositionForm({ ...positionForm, stock_id: parseInt(val) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择股票" />
                  </SelectTrigger>
                  <SelectContent>
                    {positionDialogAccountId && getAvailableStocksForAccount(positionDialogAccountId).map(stock => (
                      <SelectItem key={stock.id} value={stock.id.toString()}>
                        {stock.symbol} {stock.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>成本价</Label>
                <Input
                  value={positionForm.cost_price}
                  onChange={e => setPositionForm({ ...positionForm, cost_price: e.target.value })}
                  placeholder="0.00"
                  className="font-mono"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>持仓数量</Label>
                <Input
                  value={positionForm.quantity}
                  onChange={e => setPositionForm({ ...positionForm, quantity: e.target.value })}
                  placeholder="0"
                  className="font-mono"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div>
              <Label>投入资金 <span className="text-muted-foreground/60 text-[11px]">(盘中监控，选填)</span></Label>
              <Input
                value={positionForm.invested_amount}
                onChange={e => setPositionForm({ ...positionForm, invested_amount: e.target.value })}
                placeholder="选填"
                className="font-mono"
                inputMode="decimal"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setPositionDialogOpen(false)}>取消</Button>
              <Button
                onClick={handlePositionSubmit}
                disabled={!positionForm.cost_price || !positionForm.quantity || (!editPositionId && !positionForm.stock_id)}
              >
                {editPositionId ? '保存' : '添加'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent Assignment Dialog */}
      <Dialog open={!!agentDialogStock} onOpenChange={open => !open && setAgentDialogStock(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置监控 Agent</DialogTitle>
            <DialogDescription>
              为 {agentDialogStock?.name}（{agentDialogStock?.symbol}）配置监控策略
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {agents.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-4 text-center">暂无可用 Agent</p>
            ) : (
              agents.map(agent => {
                const stockAgent = agentDialogStock?.agents?.find(a => a.agent_name === agent.name)
                const isAssigned = !!stockAgent
                const currentSchedule = scheduleEdits[agent.name] ?? stockAgent?.schedule ?? ''
                return (
                  <div key={agent.name} className="rounded-xl bg-accent/30 hover:bg-accent/50 transition-colors overflow-hidden">
                    <div className="flex items-center justify-between p-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${agent.enabled ? 'bg-emerald-500' : 'bg-border'}`} />
                        <div>
                          <span className="text-[13px] font-medium text-foreground">{agent.display_name}</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{agent.description}</p>
                        </div>
                      </div>
                      <Switch
                        checked={isAssigned}
                        onCheckedChange={() => agentDialogStock && toggleAgent(agentDialogStock, agent.name)}
                        disabled={!agent.enabled}
                      />
                    </div>
                    {isAssigned && (
                      <div className="px-3.5 pb-3.5 pt-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                            <input
                              value={currentSchedule}
                              onChange={e => setScheduleEdits(prev => ({ ...prev, [agent.name]: e.target.value }))}
                              onBlur={() => {
                                if (agentDialogStock && currentSchedule !== (stockAgent?.schedule ?? '')) {
                                  updateSchedule(agentDialogStock, agent.name, currentSchedule)
                                }
                              }}
                              placeholder={agent.schedule || '使用全局调度'}
                              className="w-full text-[11px] font-mono pl-7 pr-2 py-1.5 rounded-lg bg-background border border-border/50 focus:outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/40"
                            />
                          </div>
                          <Button
                            variant="secondary" size="sm" className="h-7 text-[11px] px-2.5"
                            disabled={triggeringAgent === agent.name}
                            onClick={() => agentDialogStock && triggerStockAgent(agentDialogStock.id, agent.name)}
                          >
                            {triggeringAgent === agent.name ? (
                              <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            触发
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                          <Select
                            value={stockAgent?.ai_model_id?.toString() ?? '__default__'}
                            onValueChange={val => {
                              if (!agentDialogStock) return
                              updateStockAgentModel(agentDialogStock, agent.name, val === '__default__' ? null : parseInt(val))
                            }}
                          >
                            <SelectTrigger className="h-6 text-[11px] flex-1 px-2 bg-background border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">使用 Agent 默认</SelectItem>
                              {services.map(svc => (
                                <SelectGroup key={svc.id}>
                                  <SelectLabel>{svc.name}</SelectLabel>
                                  {svc.models.map(m => (
                                    <SelectItem key={m.id} value={m.id.toString()}>
                                      {m.name}{m.name !== m.model ? ` (${m.model})` : ''}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {channels.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Bell className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                            {channels.map(ch => {
                              const isSelected = (stockAgent?.notify_channel_ids || []).includes(ch.id)
                              return (
                                <button
                                  key={ch.id}
                                  onClick={() => agentDialogStock && toggleStockAgentChannel(agentDialogStock, agent.name, ch.id)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                    isSelected
                                      ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                                      : 'bg-background border-border/50 text-muted-foreground hover:border-primary/30'
                                  }`}
                                >
                                  {ch.name}
                                </button>
                              )
                            })}
                            {(stockAgent?.notify_channel_ids || []).length === 0 && (
                              <span className="text-[10px] text-muted-foreground">使用 Agent 默认</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
