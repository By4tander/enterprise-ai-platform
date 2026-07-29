/**
 * 权限管理系统
 *
 * 三级角色体系：
 *   super_admin  — 超级管理员（全平台权限）
 *   dept_admin   — 部门管理员（部门内管理权限）
 *   member       — 普通成员（基础操作权限）
 *
 * 设计原则：
 *   1. 角色 → 权限映射集中管理，修改一处全局生效
 *   2. 前端控制 UI 显示/隐藏，后端控制 API 访问（双重校验）
 *   3. 扩展新功能时只需在 PERMISSIONS 中添加新权限键
 *   4. 支持资源级权限（如"只能编辑自己创建的项目"）
 */

export type Role = 'super_admin' | 'dept_admin' | 'member'

export interface PermissionDef {
  /** 超级管理员 */
  super_admin: boolean
  /** 部门管理员 */
  dept_admin: boolean
  /** 普通成员 */
  member: boolean
}

/**
 * 权限定义表
 *
 * 添加新功能时，在此处添加新的权限键即可。
 * true = 允许, false = 禁止
 */
const PERMISSIONS: Record<string, PermissionDef> = {
  // ── 项目/工作流管理 ──
  'project.create':         { super_admin: true,  dept_admin: true,  member: true  },
  'project.rename':         { super_admin: true,  dept_admin: true,  member: false },
  'project.delete':         { super_admin: true,  dept_admin: true,  member: false },
  'project.archive':        { super_admin: true,  dept_admin: true,  member: false },
  'project.view':           { super_admin: true,  dept_admin: true,  member: true  },

  // ── 文件夹管理 ──
  'folder.create':          { super_admin: true,  dept_admin: true,  member: false },
  'folder.rename':          { super_admin: true,  dept_admin: true,  member: false },
  'folder.delete':          { super_admin: true,  dept_admin: true,  member: false },

  // ── 技能管理 ──
  'skill.import':           { super_admin: true,  dept_admin: true,  member: false },
  'skill.toggle_default':   { super_admin: true,  dept_admin: true,  member: false },
  'skill.view':             { super_admin: true,  dept_admin: true,  member: true  },
  'skill.search':           { super_admin: true,  dept_admin: true,  member: true  },
  'skill.global_manage':    { super_admin: true,  dept_admin: false, member: false },

  // ── 集群记忆 ──
  'cluster.trigger':        { super_admin: true,  dept_admin: true,  member: false },

  // ── 锁定/协作 ──
  'lock.force_takeover':    { super_admin: true,  dept_admin: false, member: false },
  'lock.request_transfer':  { super_admin: true,  dept_admin: true,  member: true  },

  // ── 对话/Agent ──
  'chat.send':              { super_admin: true,  dept_admin: true,  member: true  },
  'chat.attach_file':       { super_admin: true,  dept_admin: true,  member: true  },
  'chat.queue':             { super_admin: true,  dept_admin: true,  member: true  },

  // ── 部门管理 ──
  'department.manage':      { super_admin: true,  dept_admin: false, member: false },

  // ── 用户管理 ──
  'user.manage':            { super_admin: true,  dept_admin: false, member: false },
}

/**
 * 检查用户是否拥有指定权限
 *
 * @param role    用户角色
 * @param permKey 权限键（如 'project.rename'）
 * @returns       true = 有权限
 */
export function hasPermission(role: string | undefined, permKey: string): boolean {
  if (!role) return false
  const def = PERMISSIONS[permKey]
  if (!def) {
    console.warn(`[Permissions] 未知权限键: ${permKey}`)
    return false
  }
  return def[role as Role] ?? false
}

/**
 * 检查用户是否为管理员（super_admin 或 dept_admin）
 */
export function isAdmin(role: string | undefined): boolean {
  return role === 'super_admin' || role === 'dept_admin'
}

/**
 * 检查用户是否为超级管理员
 */
export function isSuperAdmin(role: string | undefined): boolean {
  return role === 'super_admin'
}

/**
 * 获取角色的中文显示名称
 */
export function getRoleName(role: string | undefined): string {
  switch (role) {
    case 'super_admin': return '超级管理员'
    case 'dept_admin':  return '部门管理员'
    case 'member':      return '成员'
    default:            return '未知角色'
  }
}

/**
 * React Hook: 权限检查
 *
 * 用法:
 *   const { can } = usePermissions()
 *   {can('project.rename') && <button>重命名</button>}
 */
export function usePermissions() {
  // 延迟导入避免循环依赖（实际使用时由调用方传入 role）
  return { hasPermission, isAdmin, isSuperAdmin }
}
