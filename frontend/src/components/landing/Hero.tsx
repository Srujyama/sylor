"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Play, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import { useEffect, useRef } from "react";

const floatingStats = [
  { label: "Success Rate", value: "73%", color: "text-green-400", icon: TrendingUp },
  { label: "Simulations Run", value: "2.4M+", color: "text-violet-400", icon: Zap },
  { label: "Active Users", value: "12K+", color: "text-cyan-400", icon: Users },
];

export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const particles: Array<{
      x: number; y: number; vx: number; vy: number; r: number; opacity: number;
    }> = [];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }

    let animId: number;
    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(139, 92, 246, ${p.opacity})`;
        ctx.fill();
      });

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(139, 92, 246, ${0.1 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full opacity-40"
      />

      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />

      {/* Grid pattern */}
      <div className="absolute inset-0 dot-grid opacity-30" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        {/* Badge */}
        <div className="flex justify-center mb-6">
          <Badge variant="purple" className="px-4 py-1.5 text-sm gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            Powered by Multi-Agent AI
          </Badge>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-8xl font-bold tracking-tight mb-6">
          <span className="text-white">Simulate</span>{" "}
          <span className="gradient-text text-shadow">Decisions</span>
          <br />
          <span className="text-white">Before You</span>{" "}
          <span className="gradient-text">Make Them</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed">
          Run thousands of AI simulations to predict outcomes before committing to business decisions.
          Model markets, competitors, customers, and economic forces — all without code.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
          <Button variant="gradient" size="xl" asChild className="group">
            <Link href="/signup">
              Start Simulating Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
          <Button variant="glass" size="xl" asChild className="group">
            <Link href="#demo">
              <Play className="w-5 h-5" />
              Watch Demo
            </Link>
          </Button>
        </div>

        {/* Floating stats */}
        <div className="flex flex-wrap justify-center gap-4 mb-16">
          {floatingStats.map((stat) => (
            <div
              key={stat.label}
              className="glass rounded-2xl px-6 py-4 flex items-center gap-3 neon-glow"
            >
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
              <div className="text-left">
                <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Preview dashboard mockup */}
        <div className="relative max-w-5xl mx-auto">
          <div className="glass-card rounded-2xl p-1 neon-glow">
            <div className="bg-black/40 rounded-xl overflow-hidden">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
                <div className="flex-1 mx-4 h-6 bg-white/5 rounded text-xs text-muted-foreground flex items-center px-3">
                  simworld.ai/simulations/startup-launch
                </div>
              </div>

              {/* Mock dashboard content */}
              <div className="p-6 grid grid-cols-3 gap-4">
                {/* Success prob card */}
                <div className="col-span-1 bg-gradient-to-br from-violet-500/20 to-violet-500/5 rounded-xl p-4 border border-violet-500/20">
                  <div className="text-xs text-muted-foreground mb-1">Success Probability</div>
                  <div className="text-4xl font-bold text-violet-400 mb-2">73%</div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full w-[73%] bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full" />
                  </div>
                </div>

                {/* Charts area */}
                <div className="col-span-2 bg-white/5 rounded-xl p-4 border border-white/5">
                  <div className="text-xs text-muted-foreground mb-3">Revenue Projection (12 months)</div>
                  <div className="flex items-end gap-1 h-20">
                    {[20, 35, 28, 45, 52, 48, 65, 72, 68, 85, 90, 100].map((h, i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end">
                        <div
                          className="rounded-sm bg-gradient-to-t from-violet-500 to-cyan-500 opacity-80"
                          style={{ height: `${h}%` }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Agent activity */}
                <div className="col-span-3 bg-white/5 rounded-xl p-4 border border-white/5">
                  <div className="text-xs text-muted-foreground mb-3">Agent Activity — 1,000 runs</div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Customers", count: 500, color: "bg-cyan-500" },
                      { label: "Competitors", count: 3, color: "bg-red-500" },
                      { label: "Investors", count: 12, color: "bg-yellow-500" },
                      { label: "Regulators", count: 2, color: "bg-green-500" },
                    ].map((agent) => (
                      <div key={agent.label} className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${agent.color}`} />
                        <span className="text-xs text-white">{agent.label}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{agent.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating badges around mockup */}
          <div className="absolute -top-4 -right-4 glass rounded-xl px-3 py-2 text-xs font-medium text-green-400 border border-green-500/20">
            ✓ 1,000 runs completed
          </div>
          <div className="absolute -bottom-4 -left-4 glass rounded-xl px-3 py-2 text-xs font-medium text-violet-400 border border-violet-500/20">
            ⚡ 2.3s avg run time
          </div>
        </div>
      </div>
    </section>
  );
}
