import { useState } from 'react'
import { Cloud, Loader2, ShieldCheck } from 'lucide-react'
import { davTest, loadDavConfig, saveDavConfig, type DavConfig } from '../lib/webdav'
import { resetSyncState } from '../lib/sync'

interface Props {
  onConfigured: () => void
}

/**
 * 坚果云 WebDAV 配置面板。
 * 第一次打开时引导填写服务器地址、账号、应用密码，测试通过后保存。
 */
export default function LoginGate({ onConfigured }: Props) {
  const existing = loadDavConfig()
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? 'https://dav.jianguoyun.com/dav/')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [password, setPassword] = useState(existing?.password ?? '')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  async function submit() {
    setError('')
    setOk('')
    if (!endpoint.startsWith('https://')) {
      setError('服务器地址需以 https:// 开头')
      return
    }
    if (!username.includes('@')) {
      setError('账号应为坚果云注册邮箱')
      return
    }
    if (!password.trim()) {
      setError('请输入应用密码')
      return
    }

    const cfg: DavConfig = {
      endpoint: endpoint.endsWith('/') ? endpoint : endpoint + '/',
      username: username.trim(),
      password: password.trim(),
      rootDir: 'sticky-notes',
    }

    setTesting(true)
    try {
      const r = await davTest(cfg)
      if (!r.ok) {
        setError(r.message)
        return
      }
      saveDavConfig(cfg)
      // 换了账号（或首次配置）要清掉上一份推送记录，否则会被判定成「数据没变」而跳过上传
      resetSyncState()
      setOk('连接成功，开始同步')
      setTimeout(onConfigured, 400)
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[#f6f7f3] px-5">
      <div className="w-full max-w-[400px] rounded-2xl border border-[#e8e8e2] bg-white p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="mb-1 flex items-center gap-2 text-[17px] font-medium tracking-tight text-[#1f2320]">
          <Cloud size={18} className="text-[#2f6b4f]" />
          连接坚果云同步
        </div>
        <p className="m-0 mb-5 text-[12.5px] leading-relaxed text-[#8b9188]">
          便签、图片和提醒会通过你的坚果云网盘在电脑与手机之间同步，数据始终属于你自己。
        </p>

        <div className="mb-4 rounded-lg border border-[#e7e0c8] bg-[#fbf7ea] px-3 py-2.5 text-[12px] leading-relaxed text-[#7a6a3a]">
          <div className="mb-1 flex items-center gap-1 font-medium text-[#6b5c2e]">
            <ShieldCheck size={12} /> 怎么拿到应用密码
          </div>
          登录坚果云网页版 → 右上角设置 → 安全选项 → 第三方应用管理 → 添加应用，
          生成一串「应用密码」。账号填你的邮箱，密码填那串应用密码，不要填登录密码。
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="mb-1 block text-[11.5px] text-[#7b8278]">服务器地址</label>
          <input
            value={endpoint}
            onChange={(e) => {
              setEndpoint(e.target.value)
              setError('')
            }}
            placeholder="https://dav.jianguoyun.com/dav/"
            className="mb-3 w-full rounded-lg border border-[#e4e4dd] px-3 py-2.5 text-[13.5px] outline-none placeholder:text-[#b9beb6] focus:border-[#2f6b4f]/50"
          />

          <label className="mb-1 block text-[11.5px] text-[#7b8278]">账号（注册邮箱）</label>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.trim())
              setError('')
            }}
            inputMode="email"
            placeholder="you@example.com"
            className="mb-3 w-full rounded-lg border border-[#e4e4dd] px-3 py-2.5 text-[13.5px] outline-none placeholder:text-[#b9beb6] focus:border-[#2f6b4f]/50"
          />

          <label className="mb-1 block text-[11.5px] text-[#7b8278]">应用密码</label>
          <input
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            type="password"
            placeholder="坚果云生成的应用密码"
            className="mb-3 w-full rounded-lg border border-[#e4e4dd] px-3 py-2.5 text-[13.5px] outline-none placeholder:text-[#b9beb6] focus:border-[#2f6b4f]/50"
          />

          {error && <div className="mb-1 text-[12px] text-[#c0392b]">{error}</div>}
          {ok && <div className="mb-1 text-[12px] text-[#2f6b4f]">{ok}</div>}

          <button
            type="submit"
            disabled={testing}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2f6b4f] py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {testing && <Loader2 size={13} className="animate-spin" />}
            {testing ? '测试连接中…' : '测试并连接'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            localStorage.setItem('dav-skip', '1')
            window.location.reload()
          }}
          className="mt-2.5 w-full rounded-lg border border-[#e4e4dd] py-2 text-[12.5px] text-[#7b8278] transition-colors hover:bg-[#f7f7f2]"
        >
          先不同步，直接用
        </button>

        <p className="m-0 mt-3 text-[11.5px] leading-relaxed text-[#a8ada4]">
          跳过之后便签只存在这台电脑上。以后想同步，点左下角账号处随时可以配置。
        </p>
      </div>
    </div>
  )
}
