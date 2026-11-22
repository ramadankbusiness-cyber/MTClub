"use client";
import Image from "next/image";
import { Link, usePathname } from "@/i18n/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useSite } from "./site-provider";
import { NotificationBell } from "./notification-bell";

const links = [
  { href: "/", key: "home" },
  { href: "/about", key: "about" },
  { href: "/events", key: "events" },
  { href: "/team", key: "team" },
  { href: "/join", key: "join" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const { text, language, toggleLanguage, toggleTheme } = useSite();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="nav-inner">
        <Link className="brand" href="/" aria-label={text.nav.homeLabel} onClick={() => setMenuOpen(false)}>
          <Image src="/mt-logo.png" alt="" width={38} height={38} priority />
          <span>MT Club</span>
        </Link>
        <nav id="site-navigation" className={`main-nav${menuOpen ? " is-open" : ""}`} aria-label={language === "ar" ? "التنقل الرئيسي" : "Main navigation"}>
          {links.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={pathname === href ? "nav-link active" : "nav-link"}
              onClick={() => setMenuOpen(false)}
            >
              {text.nav[key]}
            </Link>
          ))}
          
        </nav>
        <div className="nav-actions">
          <button className="icon-button language-button language-desktop" type="button" onClick={toggleLanguage} aria-label={text.nav.switchTo}>
            {text.nav.language}
          </button>
          <button className="icon-button theme-button" type="button" onClick={toggleTheme} aria-label={text.nav.theme}>
            <span aria-hidden="true">◐</span>
          </button>
          {session?.user ? (
            <div className="account-actions">
              <NotificationBell />
              <button className="avatar-button" type="button" aria-expanded={accountMenuOpen} aria-label={text.nav.account} onClick={() => setAccountMenuOpen((open) => !open)}>
                {session.user.image ? <Image src={session.user.image} alt={session.user.name ? `${session.user.name} profile photo` : "Profile photo"} width={34} height={34} /> : <Image src="/mt-logo.png" alt="MT Club logo" width={34} height={34} />}
              </button>
              {accountMenuOpen && (
                <div className="account-menu">
                  <p>{session.user.name}</p>
                  <Link href="/dashboard" onClick={() => setAccountMenuOpen(false)}>{text.nav.dashboard}</Link>
                  <Link href="/attendance" onClick={() => setAccountMenuOpen(false)}>{text.nav.attendance}</Link>
                  {(session.user.role === "ADMIN" || session.user.role === "LEADER") && <Link href="/admin/reports" onClick={() => setAccountMenuOpen(false)}>{text.nav.attendanceReports}</Link>}
                  {session.user.role === "ADMIN" && <Link href="/admin/points" onClick={() => setAccountMenuOpen(false)}>{text.nav.pointsManagement}</Link>}
                  {session.user.role === "ADMIN" && <Link href="/admin/analytics" onClick={() => setAccountMenuOpen(false)}>{text.nav.memberAnalytics}</Link>}
                  <Link href="/leaderboard" onClick={() => setAccountMenuOpen(false)}>{text.nav.leaderboard}</Link>
                  <Link href="/excuses" onClick={() => setAccountMenuOpen(false)}>{text.nav.excuses}</Link>
                  <Link href="/profile" onClick={() => setAccountMenuOpen(false)}>{text.nav.profile}</Link>
                  <Link href="/notifications" onClick={() => setAccountMenuOpen(false)}>{text.nav.notifications}</Link>
                  {(session.user.role === "ADMIN" || session.user.role === "LEADER") && <Link href="/admin/notifications" onClick={() => setAccountMenuOpen(false)}>{text.nav.sendNotifications}</Link>}
                  {session.user.role === "ADMIN" && <>
                    <Link href="/admin/applications" onClick={() => setAccountMenuOpen(false)}>{text.nav.applications}</Link>
                    <Link href="/admin/users" onClick={() => setAccountMenuOpen(false)}>{text.nav.manageAccounts}</Link>
                    <Link href="/admin/events" onClick={() => setAccountMenuOpen(false)}>{text.nav.manageEvents}</Link>
                    <Link href="/admin/zones" onClick={() => setAccountMenuOpen(false)}>{text.nav.zones}</Link>
                    <Link href="/admin/audit" onClick={() => setAccountMenuOpen(false)}>{text.nav.audit}</Link>
                  </>}
                  <button type="button" onClick={() => signOut({ callbackUrl: `/${language}` })}>{text.nav.logout}</button>
                </div>
              )}
            </div>
          ) : <Link className="button button-secondary login-button" href="/login">{text.nav.login}</Link>}
          {!session?.user && <Link className="button button-primary nav-join" href="/join">{text.nav.joinUs}<span aria-hidden="true">↗</span></Link>}
          <button className="icon-button menu-button" type="button" aria-label={text.nav.menu} aria-controls="site-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
