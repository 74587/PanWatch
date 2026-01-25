import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Play, Database, Newspaper, LineChart, TrendingUp } from 'lucide-react'
import { fetchAPI, type DataSource } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'

interface TestResult {
  success: boolean
  type: string
  message: string
  items?: Array<{ title?: string; name?: string; time?: string; price?: number; change_pct?: number; importance?: number }>
  image?: string
  count?: number
}

interface DataSourceForm {
  name: string
  type: string
  provider: string
  config: Record<string, unknown>
  priority: number
}

const DATASOURCE_TYPES = {
  news: { label: '新闻资讯', icon: Newspaper, color: 'text-blue-500' },
  chart: { label: 'K线图表', icon: LineChart, color: 'text-purple-500' },
  quote: { label: '实时行情', icon: TrendingUp, color: 'text-emerald-500' },
}

const PROVIDER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  news: [
    { value: 'sina', label: '新浪财经快讯' },
    { value: 'eastmoney', label: '东方财富公告' },
  ],
  chart: [
    { value: 'xueqiu', label: '雪球' },
    { value: 'sina', label: '新浪财经' },
    { value: 'eastmoney', label: '东方财富' },
  ],
  quote: [
    { value: 'tencent', label: '腾讯行情' },
  ],
}

const emptyForm: DataSourceForm = { name: '', type: 'news', provider: '', config: {}, priority: 0 }

export default function DataSourcesPage() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<DataSourceForm>(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testResultOpen, setTestResultOpen] = useState(false)

  const { toast } = useToast()

  const load = async () => {
    try {
      const data = await fetchAPI<DataSource[]>('/datasources')
      setSources(data)
    } catch (e) {
      console.error(e)
      toast('加载数据源失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openDialog = (source?: DataSource) => {
    if (source) {
      setForm({
        name: source.name,
        type: source.type,
        provider: source.provider,
        config: source.config || {},
        priority: source.priority,
      })
      setEditId(source.id)
    } else {
      setForm(emptyForm)
      setEditId(null)
    }
    setDialogOpen(true)
  }

  const saveSource = async () => {
    try {
      const payload = {
        name: form.name,
        type: form.type,
        provider: form.provider,
        config: form.config,
        priority: form.priority,
        enabled: true,
      }
      if (editId) {
        await fetchAPI(`/datasources/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await fetchAPI('/datasources', { method: 'POST', body: JSON.stringify(payload) })
      }
      setDialogOpen(false)
      load()
      toast(editId ? '数据源已更新' : '数据源已创建', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败', 'error')
    }
  }

  const deleteSource = async (id: number) => {
    if (!confirm('确定删除此数据源？')) return
    try {
      await fetchAPI(`/datasources/${id}`, { method: 'DELETE' })
      load()
      toast('数据源已删除', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败', 'error')
    }
  }

  const toggleEnabled = async (source: DataSource) => {
    try {
      await fetchAPI(`/datasources/${source.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !source.enabled }),
      })
      load()
    } catch {
      toast('操作失败', 'error')
    }
  }

  const testSource = async (id: number) => {
    setTesting(id)
    try {
      const result = await fetchAPI<TestResult>(`/datasources/${id}/test`, { method: 'POST' })
      setTestResult(result)
      setTestResultOpen(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : '测试失败', 'error')
    } finally {
      setTesting(null)
    }
  }

  // Group sources by type
  const groupedSources = sources.reduce((acc, source) => {
    const type = source.type
    if (!acc[type]) acc[type] = []
    acc[type].push(source)
    return acc
  }, {} as Record<string, DataSource[]>)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">数据源</h1>
          <p className="text-[13px] text-muted-foreground mt-1">管理新闻、K线图和行情数据来源</p>
        </div>
        <Button onClick={() => openDialog()}>
          <Plus className="w-4 h-4" /> 添加数据源
        </Button>
      </div>

      <div className="space-y-6">
        {Object.entries(DATASOURCE_TYPES).map(([type, { label, icon: Icon, color }]) => (
          <section key={type} className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Icon className={`w-4 h-4 ${color}`} />
              <h3 className="text-[13px] font-semibold text-foreground">{label}</h3>
              <span className="text-[11px] text-muted-foreground ml-auto">
                {groupedSources[type]?.length || 0} 个数据源
              </span>
            </div>

            {(!groupedSources[type] || groupedSources[type].length === 0) ? (
              <p className="text-[13px] text-muted-foreground text-center py-6">暂无{label}数据源</p>
            ) : (
              <div className="space-y-2">
                {groupedSources[type].map(source => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-accent/30 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Database className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[13px] font-medium text-foreground">{source.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-muted-foreground font-mono">{source.provider}</span>
                          <span className="text-[11px] text-muted-foreground">优先级: {source.priority}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => testSource(source.id)}
                        disabled={testing === source.id || !source.enabled}
                        title="测试连接"
                      >
                        {testing === source.id ? (
                          <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </Button>
                      <Switch checked={source.enabled} onCheckedChange={() => toggleEnabled(source)} />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDialog(source)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => deleteSource(source.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? '编辑数据源' : '添加数据源'}</DialogTitle>
            <DialogDescription>配置数据采集来源</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>名称</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="如 财联社电报"
              />
            </div>
            <div>
              <Label>类型</Label>
              <Select
                value={form.type}
                onValueChange={val => setForm({ ...form, type: val, provider: '' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATASOURCE_TYPES).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>数据提供商</Label>
              <Select
                value={form.provider}
                onValueChange={val => setForm({ ...form, provider: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择提供商" />
                </SelectTrigger>
                <SelectContent>
                  {(PROVIDER_OPTIONS[form.type] || []).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>优先级 <span className="text-muted-foreground font-normal">(数字越小优先级越高)</span></Label>
              <Input
                type="number"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={saveSource} disabled={!form.name || !form.provider}>
                {editId ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Result Dialog */}
      <Dialog open={testResultOpen} onOpenChange={setTestResultOpen}>
        <DialogContent className={testResult?.type === 'chart' ? 'max-w-3xl' : ''}>
          <DialogHeader>
            <DialogTitle>测试结果</DialogTitle>
            <DialogDescription>{testResult?.message}</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            {testResult?.type === 'chart' && testResult.image && (
              <div className="rounded-lg overflow-hidden border">
                <img src={testResult.image} alt="K线图截图" className="w-full" />
              </div>
            )}
            {testResult?.type === 'news' && testResult.items && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {testResult.items.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground text-center py-4">暂无数据</p>
                ) : (
                  testResult.items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-accent/30">
                      {item.importance !== undefined && item.importance >= 2 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 flex-shrink-0">
                          重要
                        </span>
                      )}
                      <span className="text-[12px] text-foreground flex-1">{item.title}</span>
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">{item.time}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            {testResult?.type === 'quote' && testResult.items && (
              <div className="space-y-2">
                {testResult.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-accent/30">
                    <span className="text-[13px] font-medium text-foreground">{item.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-mono">{item.price?.toFixed(2)}</span>
                      <span className={`text-[12px] font-medium ${
                        (item.change_pct ?? 0) > 0 ? 'text-red-500' : (item.change_pct ?? 0) < 0 ? 'text-green-500' : 'text-muted-foreground'
                      }`}>
                        {(item.change_pct ?? 0) > 0 ? '+' : ''}{item.change_pct?.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
