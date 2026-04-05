"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./Header.css";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`header ${scrolled ? "scrolled" : ""}`}>
      <Link href="/" className="header-logo">
        <div className="header-logo-icon">N</div>
        <div className="header-logo-text">
          nog<span>clip</span>
        </div>
      </Link>
      <nav className="header-nav">
        <Link 
          href="/" 
          className={`header-nav-link ${pathname === "/" ? "active" : ""}`}
        >
          Home
        </Link>
        <Link 
          href="/projects" 
          className={`header-nav-link ${pathname === "/projects" ? "active" : ""}`}
        >
          Projects
        </Link>
        <Link 
          href="/studio" 
          className={`header-nav-link ${pathname === "/studio" ? "active" : ""}`}
        >
          Studio
        </Link>
        <Link href="/studio" className="btn btn-primary btn-sm">
          Start Clipping
        </Link>
      </nav>
    </header>
  );
}
