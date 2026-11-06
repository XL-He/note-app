/**
 * 安卓打包脚本。
 *
 * 所有工具链状态都留在项目目录内：
 *   .android-toolchain/jdk-17...   JDK
 *   .android-toolchain/sdk         Android SDK
 *   .android-toolchain/gradle-home Gradle 发行版与依赖缓存
 * 删掉 .android-toolchain 就等于把安卓构建环境彻底卸载，系统里不留东西。
 *
 * 用法：
 *   node scripts/build-android.mjs           打 debug 包（可直接装，无需签名配置）
 *   node scripts/build-android.mjs release   打 release 包（未签名）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TC = path.join(ROOT, '.android-toolchain')
const SDK = path.join(TC, 'sdk')
const GRADLE_HOME = path.join(TC, 'gradle-home')
const ANDROID_DIR = path.join(ROOT, 'android')

function findJdk() {
  if (!fs.existsSync(TC)) return null
  const jdks = fs.readdirSync(TC).filter((n) => n.startsWith('jdk'))
  if (!jdks.length) return null
  // Capacitor 8 的插件要求 Java 21，优先选 21；只有 17 时会编译失败
  const preferred = jdks.find((n) => n.includes('jdk-21')) ?? jdks.find((n) => n.includes('jdk-17'))
  return path.join(TC, preferred ?? jdks[0])
}

const JDK = findJdk()

if (!JDK || !fs.existsSync(JDK)) {
  console.error('找不到 JDK。请确认 .android-toolchain 下存在 jdk-17* 目录')
  process.exit(1)
}
if (!fs.existsSync(path.join(SDK, 'platforms'))) {
  console.error('找不到 Android SDK platform。请先安装 platforms;android-36')
  process.exit(1)
}

const mode = process.argv[2] === 'release' ? 'assembleRelease' : 'assembleDebug'

const env = {
  ...process.env,
  JAVA_HOME: JDK,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  // 让 Gradle 把发行版和依赖缓存都写进项目目录，避免污染用户目录
  GRADLE_USER_HOME: GRADLE_HOME,
  // 有些环境会带这个变量，会让某些工具链行为异常
  ELECTRON_RUN_AS_NODE: undefined,
}
delete env.ELECTRON_RUN_AS_NODE

function run(cmd, args, cwd, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${label}`)
    const p = spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} 失败，退出码 ${code}`))))
  })
}

async function main() {
  // 0. 告诉 Gradle 去哪找 SDK。每次生成，避免路径变化后失效。
  fs.writeFileSync(
    path.join(ANDROID_DIR, 'local.properties'),
    `# 由 scripts/build-android.mjs 自动生成\nsdk.dir=${SDK.replace(/\\/g, '/')}\n`,
    'utf8',
  )

  // 1. 先构建前端产物
  await run('npm', ['run', 'build'], ROOT, '构建前端')

  // 2. 同步到安卓工程
  await run('npx', ['cap', 'sync', 'android'], ROOT, '同步到安卓工程')

  // 3. 编译 APK
  // 注意：项目路径里带空格（work Buddy），所以不能传绝对路径当命令，
  // 用 cwd 切到 android 目录、命令只写相对名，绕开 shell 的引号问题。
  const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
  await run(gradleCmd, [mode], ANDROID_DIR, `编译 APK（${mode}）`)

  // 4. 收集产物，改成好认的名字
  const variant = mode === 'assembleRelease' ? 'release' : 'debug'
  const apkPath = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`)
  if (!fs.existsSync(apkPath)) {
    console.error(`没找到 APK：${apkPath}`)
    process.exit(1)
  }

  const outDir = path.join(ROOT, 'release-android')
  fs.mkdirSync(outDir, { recursive: true })
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const target = path.join(outDir, `便签-${version}-${variant}.apk`)
  fs.copyFileSync(apkPath, target)

  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`\n✅ APK 已生成：${target}（${mb} MB）`)
}

main().catch((e) => {
  console.error('\n✗', e.message)
  process.exit(1)
})
