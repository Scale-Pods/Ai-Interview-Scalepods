import { useEffect, useState } from 'react'
import { supabase } from '@/api/client'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  loading: boolean
  role: 'hr_admin' | 'hr_recruiter' | 'hr_viewer' | 'candidate' | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, role: null })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setState({
          user: session.user,
          loading: false,
          role: (session.user.app_metadata?.role as AuthState['role']) || null
        })
      } else {
        setState({ user: null, loading: false, role: null })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setState({
          user: session.user,
          loading: false,
          role: (session.user.app_metadata?.role as AuthState['role']) || null
        })
      } else {
        setState({ user: null, loading: false, role: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, role = 'hr_admin') => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { role } }
    })
    if (error) throw error
  }

  const loginWithSSO = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure' as never,
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    })
    if (error) throw error
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  return { ...state, login, loginWithSSO, signUp, logout }
}
