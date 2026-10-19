import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  if (!tokenHash || type !== 'invite') {
    return NextResponse.redirect(
      `${origin}/login?error=invalid_invite`
    )
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'invite',
  })

  if (error) {
    console.error('Invite verification failed:', error)

    return NextResponse.redirect(
      `${origin}/login?error=invalid_invite`
    )
  }

  // Invitation successfully verified.
  // Supabase server client stores the authenticated
  // session in the user's cookies.

  return NextResponse.redirect(`${origin}/register`)
}