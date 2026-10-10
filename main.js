const entries = (value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

const request = async (url, options, label) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`${label}: 接口返回非 JSON 数据，请检查网站是否可访问`)
  }
  if (result?.code !== 0) {
    throw new Error(`${label}: ${result?.message || '接口响应异常'} (code=${result?.code ?? '缺失'}${result?.reason ? ', reason=' + result.reason : ''})`)
  }
  return result
}

const glados = async () => {
  const notice = []
  const cookies = entries(process.env.GLADOS)
  const agents = entries(process.env.GLADOS_UA)
  if (!cookies.length) throw new Error('请配置 Secret GLADOS，值为登录 GLaDOS 后的完整 Cookie')
  if (!agents.length) throw new Error('请配置 Secret GLADOS_UA，值为同一登录浏览器的 navigator.userAgent')
  if (agents.length !== 1 && agents.length !== cookies.length) {
    throw new Error('GLADOS_UA 必须为一行共用，或按行与 GLADOS 中的账号一一对应')
  }
  let failed = 0
  for (const [index, cookie] of cookies.entries()) {
    const account = `账号 ${index + 1}`
    let phase = '签到请求'
    try {
      const common = {
        'cookie': cookie,
        'referer': 'https://glados.cloud/console/checkin',
        'user-agent': agents[index] || agents[0],
      }
      const action = await request('https://glados.cloud/api/user/checkin', {
        method: 'POST',
        headers: { ...common, 'content-type': 'application/json' },
        body: '{"token":"glados.cloud"}',
      }, phase)
      console.log(`[${account}] Checkin OK: ${action.message || '签到接口返回成功'}`)
      phase = '签到后状态查询'
      const status = await request('https://glados.cloud/api/user/status', {
        method: 'GET',
        headers: { ...common },
      }, phase)
      const leftDays = Number(status?.data?.leftDays)
      if (status?.data?.leftDays == null || !Number.isFinite(leftDays)) {
        throw new Error('状态接口缺少有效的 leftDays')
      }
      console.log(`[${account}] Left Days ${leftDays}`)
      notice.push(
        'Checkin OK',
        `${action?.message}`,
        `Left Days ${leftDays}`
      )
    } catch (error) {
      failed += 1
      process.exitCode = 1
      console.error(`[${account}] ${phase}失败: ${error.message}`)
      notice.push(
        `Checkin Error (${account}, ${phase})`,
        `${error}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }
  console.log(`处理完成: ${cookies.length - failed} 个账号签到及状态查询成功，${failed} 个账号处理失败`)
  return notice
}

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return
  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue
    try {
      if (option.startsWith('console:')) {
        for (const line of notice) {
          console.log(line)
        }
      } else if (option.startsWith('wxpusher:')) {
        await fetch(`https://wxpusher.zjiecode.com/api/send/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appToken: option.split(':')[1],
            summary: notice[0],
            content: notice.join('<br>'),
            contentType: 3,
            uids: option.split(':').slice(2),
          }),
        })
      } else if (option.startsWith('pushplus:')) {
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option.split(':')[1],
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      } else if (option.startsWith('qyweixin:')) {
        const qyweixinToken = option.split(':')[1]
        const qyweixinNotifyRebotUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyweixinToken;
        await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                content: notice.join('<br>')
            }
          }),
        })
      } else {
        // fallback
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      }
    } catch (error) {
      throw error
    }
  }
}

const main = async () => {
  await notify(await glados())
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
