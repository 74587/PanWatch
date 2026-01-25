import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Trash2, RefreshCw, ScrollText } from 'lucide-react'
import { fetchAPI, useLocalStorage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface LogEntry {
  id: number
  timestamp: string
  level: string
  logger_name: string
  message: string
}

interface LogListResponse {
  items: LogEntry[]
  total: number
}

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

const LEVEL_DOT: Record<string, string> = {
  DEBUG: 'bg-slate-400',
  INFO: 'bg-blue-500',
  WARNING: 'bg-amber-500',
  ERROR: 'bg-red-500',
  CRITICAL: 'bg-red-700',
}

const TIME_RANGES = [
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '全部', value: 0 },
]

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<string[]>([])
  const [timeRange, setTimeRange] = useState(0)
  const [autoRefresh, setAutoRefresh] = useLocalStorage('panwatch_logs_autoRefresh', false)
  const [offset, setOffset] = useState(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const refreshTimer = useRef<ReturnType<typeof setInterval>>()
  const limit = 200

  const load = useCallback(async (currentOffset = 0) => {
    try {
      const params = new URLSearchParams()
      if (selectedLevels.length > 0) params.set('level', selectedLevels.join(','))
      if (query) params.set('q', query)
      if (timeRange > 0) {
        const since = new Date(Date.now() - timeRange * 3600 * 1000).toISOString()
        params.set('since', since)
      }
      params.set('limit', String(limit))
      params.set('offset', String(currentOffset))
      const data = await fetchAPI<LogListResponse>(`/logs?${params.toString()}`)
      setLogs(data.items)
      setTotal(data.total)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [selectedLevels, query, timeRange])

  useEffect(() => { setOffset(0); load(0) }, [load])

  useEffect(() => {
    if (autoRefresh) {
      refreshTimer.current = setInterval(() => load(offset), 3000)
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [autoRefresh, load, offset])

  const handleSearchInput = (value: string) => {
    setQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setOffset(0), 300)
  }

  const toggleLevel = (level: string) => {
    setSelectedLevels(prev => prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level])
    setOffset(0)
  }

  const handleClear = async () => {
    if (!confirm('确定清空所有日志？')) return
    await fetchAPI('/logs', { method: 'DELETE' })
    setLogs([]); setTotal(0)
  }

  const handlePageChange = (newOffset: number) => { setOffset(newOffset); load(newOffset) }

  const formatTime = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  const totalPages = Math.ceil(total / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h1 className="text-[20px] md:text-[22px] font-bold text-foreground tracking-tight">日志</h1>
          <p className="text-[12px] md:text-[13px] text-muted-foreground mt-0.5 md:mt-1">后台运行日志与调试信息</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'secondary'}
            size="sm"
            className="h-8"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">自动刷新</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-8 hover:text-destructive hover:bg-destructive/8" onClick={handleClear}>
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">清空</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="搜索日志内容..."
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {LEVELS.map(level => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                selectedLevels.includes(level)
                  ? 'bg-primary text-white'
                  : 'bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${selectedLevels.includes(level) ? 'bg-white/70' : LEVEL_DOT[level]}`} />
              {level}
            </button>
          ))}

          <span className="w-px h-5 bg-border mx-2" />

          {TIME_RANGES.map(range => (
            <button
              key={range.value}
              onClick={() => { setTimeRange(range.value); setOffset(0) }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                timeRange === range.value
                  ? 'bg-primary text-white'
                  : 'bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              {range.label}
            </button>
          ))}

          <span className="ml-auto text-[11px] text-muted-foreground font-medium">{total} 条记录</span>
        </div>
      </div>

      {/* Log table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <ScrollText className="w-6 h-6 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">暂无日志</p>
          <p className="text-[13px] text-muted-foreground mt-1.5">后台运行后日志会自动出现在这里</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-400px)] overflow-y-auto">
            <table className="w-full text-[12px] font-mono">
              <thead className="sticky top-0 bg-card z-10 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-32">时间</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-20">级别</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-36">Logger</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">消息</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id} className={`hover:bg-accent/30 transition-colors ${i > 0 ? 'border-t border-border/20' : ''}`}>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{formatTime(log.timestamp)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[log.level] || 'bg-slate-400'}`} />
                        <span className="text-muted-foreground">{log.level}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground truncate max-w-[144px]" title={log.logger_name}>{log.logger_name}</td>
                    <td className="px-4 py-2 whitespace-pre-wrap break-all text-foreground/80">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/30">
              <Button variant="ghost" size="sm" onClick={() => handlePageChange(Math.max(0, offset - limit))} disabled={offset === 0}>
                上一页
              </Button>
              <span className="text-[12px] text-muted-foreground font-medium">{currentPage} / {totalPages}</span>
              <Button variant="ghost" size="sm" onClick={() => handlePageChange(offset + limit)} disabled={currentPage >= totalPages}>
                下一页
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
