import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { writeFileSync } from 'node:fs'
export const inject = ['appReady', 'agents', 'tools', 'sessionController', 'workspaceRegistry']
export function apply(ctx, config) {
  const controller = new AbortController()
  let operation
  ctx.effect(() => ctx.appReady.onReady(() => {
    operation = (async () => {
      const workspace = await ctx.workspaceRegistry.create(config.workspace, 'Project Ops 隔离验收')
      const created = await ctx.sessionController.create({ workspaceId: workspace.id, sessionId: 'project-ops-ui-acceptance-v3' })
      const agent = ctx.agents.get(created.sessionId)
      if (agent.session.deriveMessages().length === 0) agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Project Ops 隔离界面验收样例；此消息由测试夹具写入，没有调用模型。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      let index = 0
      const call = async (name, args) => {
        const result = await ctx.agents.withInitiator(agent, () => ctx.tools.execute({ callId: `ui-fixture-v3-${++index}`, name, arguments: args, agent, signal: controller.signal }))
        if (result.isError) throw new Error(JSON.stringify(result.content))
        return result.value
      }
      let listed = await call('missher_project_ops_document_read', {})
      if (!listed.tasks.some(task => task.status !== 'unavailable')) {
        const task = await call('missher_project_ops_document_write', { action: 'begin', slug: 'ui-acceptance', data: { title: 'Project Ops 最终界面验收', requirements: '可发现的方案与交付入口', design: '使用原生会话、文件系统及预览', steps: ['创建方案', '记录交付', '点击预览'], acceptance: ['两个预览入口可用'], progress: '文档已准备，等待可见交互验收' } })
        await call('missher_project_ops_document_write', { action: 'finish', taskId: task.taskId, expectedRevision: task.revision, data: { implementation: '隔离原生 Host 生成的样例文档', checks: [{ criterion: '两个预览入口可用', status: 'unverified', evidence: '等待浏览器实际点击；本文件不是验收结论' }], artifacts: [task.planPath], git: '未提交', release: '未发布', installation: '仅隔离 profile', limitations: ['真实模型未调用', 'Intel Mac 未验证'], rollback: '关闭隔离 Host，保留本样例作证据' } })
      }
      listed = await call('missher_project_ops_document_read', {})
      const own = listed.tasks.filter(task => task.status !== 'unavailable')
      if (!own.some(task => task.title === '追加开发后的历史交付')) {
        const data = { title: '追加开发后的历史交付', requirements: '展示历史状态', design: '原生文档工具', steps: ['检查状态'], acceptance: ['状态明确'], progress: '示例' }
        const task = await call('missher_project_ops_document_write', { action: 'begin', slug: 'ui-history', data })
        const reviewed = await call('missher_project_ops_document_write', { action: 'finish', taskId: task.taskId, expectedRevision: task.revision, data: { implementation: '历史样例', checks: [{ criterion: '状态明确', status: 'unverified', evidence: '等待可见检查' }], artifacts: [], git: '未提交', release: '未发布', installation: '仅隔离', limitations: [], rollback: '保留样例' } })
        await call('missher_project_ops_document_write', { action: 'update', taskId: task.taskId, expectedRevision: reviewed.revision, data: { ...data, progress: '追加开发中，旧交付保留作历史' } })
        await call('missher_project_ops_document_write', { action: 'begin', slug: 'ui-pending', data: { ...data, title: '尚未交付的任务' } })
      }
      writeFileSync(config.report, JSON.stringify({ passed: true, sessionId: created.sessionId, workspace: config.workspace, modelRequestInitiatedByFixture: false }, null, 2))
    })().catch(error => { writeFileSync(config.report, JSON.stringify({ passed: false, error: String(error.stack) }, null, 2)) })
  }))
  ctx.effect(() => async () => { controller.abort(); await operation })
}
