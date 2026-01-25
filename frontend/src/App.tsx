import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Moon, Sun, TrendingUp, Bot, ScrollText, Settings, List, Database } from 'lucide-react'
import { useTheme } from '@/hooks/use-theme'
import StocksPage from '@/pages/Stocks'
import AgentsPage from '@/pages/Agents'
import SettingsPage from '@/pages/Settings'
import LogsPage from '@/pages/Logs'
import DataSourcesPage from '@/pages/DataSources'

const navItems = [
  { to: '/', icon: List, label: '自选股' },
  { to: '/agents', icon: Bot, label: 'Agent' },
  { to: '/datasources', icon: Database, label: '数据源' },
  { to: '/logs', icon: ScrollText, label: '日志' },
  { to: '/settings', icon: Settings, label: '设置' },
]

function App() {
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()

  return (
    <div className="min-h-screen">
      {/* Floating Nav */}
      <div className="sticky top-0 z-50 px-6 pt-4 pb-2">
        <header className="card px-5">
          <div className="h-14 flex items-center justify-between">
            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-[0_2px_8px_rgba(79,70,229,0.25)]">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <span className="text-[15px] font-bold text-foreground">PanWatch</span>
            </NavLink>

            {/* Nav Links */}
            <nav className="flex items-center gap-1">
              {navItems.map(({ to, icon: Icon, label }) => {
                const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={`px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-primary/8 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="w-4 h-4" />
                      {label}
                    </span>
                  </NavLink>
                )
              })}
            </nav>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>
      </div>

      {/* Content */}
      <main className="px-6 py-6">
        <Routes>
          <Route path="/" element={<StocksPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/datasources" element={<DataSourcesPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
