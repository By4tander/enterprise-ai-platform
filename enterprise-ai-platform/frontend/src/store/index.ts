import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  display_name: string;
  role: string;
  department_id: string | null;
  department_name?: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('access_token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  setAuth: (token, user) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user });
    // 非 Super Admin 自动锁定当前部门
    if (user.role !== 'super_admin' && user.department_id) {
      const appStore = useAppStore.getState();
      appStore.setCurrentDepartment(user.department_id);
    }
  },
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    set({ token: null, user: null });
  },
  isAuthenticated: () => !!get().token,
}));

interface AppState {
  currentProjectId: string | null;
  currentDepartmentId: string | null;
  sidebarOpen: boolean;
  setCurrentProject: (id: string | null) => void;
  setCurrentDepartment: (id: string | null) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentProjectId: null,
  currentDepartmentId: null,
  sidebarOpen: true,
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setCurrentDepartment: (id) => set({ currentDepartmentId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
