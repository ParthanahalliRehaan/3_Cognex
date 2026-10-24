"""Regenerates docs/q1-architecture.(png|svg).  python scripts/make_diagram.py  (needs matplotlib)"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
BLUE,GREEN,ORANGE,GREY,PURPLE="#2b6cb0","#2f855a","#dd6b20","#4a5568","#6b46c1"
fig,ax=plt.subplots(figsize=(17,9.5)); ax.set_xlim(0,17); ax.set_ylim(0,9.5); ax.axis("off")
def box(x,y,w,h,title,sub="",c=BLUE,fill=None,fs=11,subfs=8.5):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle="round,pad=0.02,rounding_size=0.12",ec=c,fc=fill or "white",lw=2))
    ax.text(x+w/2,y+h-0.28,title,ha="center",va="center",fontsize=fs,fontweight="bold",color=c)
    if sub: ax.text(x+w/2,y+(h-0.5)/2,sub,ha="center",va="center",fontsize=subfs,color="#222",linespacing=1.35)
def arrow(a,b,c=BLUE,label="",ls="-",rad=0.0,lx=None,ly=None,ha="center"):
    ax.add_patch(FancyArrowPatch(a,b,arrowstyle="-|>",mutation_scale=16,color=c,lw=2,ls=ls,connectionstyle=f"arc3,rad={rad}"))
    if label: ax.text(lx,ly,label,ha=ha,va="bottom",fontsize=8.5,color=c,fontweight="bold",bbox=dict(fc="white",ec="none",pad=1))
ax.text(8.5,9.2,"Cognex: DA3 scaled and secured architecture",ha="center",fontsize=16,fontweight="bold")
ax.add_patch(FancyBboxPatch((5.0,0.7),6.4,6.4,boxstyle="round,pad=0.02,rounding_size=0.2",ec=GREY,fc="#f7fafc",lw=1.5,ls="--"))
ax.text(5.15,0.82,"Docker Compose (project: cognex)",fontsize=9.5,color=GREY,fontweight="bold")
box(0.2,3.7,2.0,1.3,"User browser","students",GREY)
box(2.7,3.7,2.0,1.3,"Cloudflare Pages","Cognex frontend\n(API_BASE -> Nginx)",BLUE)
box(5.3,3.7,1.9,1.3,"Nginx :80","load balancer\nround-robin + failover",BLUE)
for i,y in enumerate([5.5,3.7,1.9]):
    box(8.4,y,2.7,1.3,f"cognex-backend{i+1}",f"host :300{i+1} -> container :3000\nHono on @hono/node-server\nbcrypt · TOTP MFA · RBAC",BLUE)
    arrow((7.2,4.35),(8.4,y+0.65),BLUE)
box(5.3,1.2,1.9,1.1,"Prometheus :9090","scrapes /metrics (5 s)",GREY,fs=10)
box(8.7,1.05,2.4,0.7,"Grafana :3030","",GREY,fs=10)
arrow((7.2,1.6),(8.7,1.4),GREY,ls="--")
box(13.2,3.0,3.4,2.6,"Supabase","PostgreSQL + pgvector\ngraph_nodes · graph_edges · documents\nusers (bcrypt hash, TOTP secret enc.)\naudit_log (append-only)",GREEN)
for y in [6.15,4.35,2.55]: arrow((11.1,y),(13.2,4.3),GREEN)
box(13.2,0.5,3.4,1.7,"Security-monitor agents","LangGraph: analyst -> classifier -> reporter\nread-only · e-mails/IPs masked\nGroq Llama 3.3 70B · Langfuse traces",PURPLE,fs=10.5,subfs=8.3)
arrow((14.9,2.2),(14.9,3.0),PURPLE,"reads audit_log",ls="--",lx=15.0,ly=2.4,ha="left")
arrow((2.2,4.35),(2.7,4.35),GREY); arrow((4.7,4.35),(5.3,4.35),BLUE)
box(5.3,7.7,5.8,1.0,"Cloudflare Worker: cognex-worker","original DA1 deployment (workers.dev) = burst target",ORANGE,fill="#fffaf0")
arrow((6.25,5.0),(6.25,7.7),ORANGE,"overflow: limit_conn 503 or 502-504 -> error_page @burst",lx=6.4,ly=7.2,ha="left")
arrow((11.1,8.2),(14.9,5.6),ORANGE,"burst traffic reads the same DB",rad=-0.15,lx=13.6,ly=7.5)
lx,ly=0.3,2.4
ax.text(lx,ly+0.5,"Legend",fontweight="bold",fontsize=10)
for i,(c,t) in enumerate([(BLUE,"Local scaled stack (normal load)"),(ORANGE,"Cloud bursting (spike overflow)"),(GREEN,"Managed cloud database"),(PURPLE,"Security monitor (advisory only)"),(GREY,"Observability / client")]):
    ax.add_patch(FancyBboxPatch((lx,ly-0.35*i-0.12),0.35,0.22,boxstyle="round,pad=0.01",ec=c,fc=c)); ax.text(lx+0.5,ly-0.35*i-0.02,t,fontsize=9,va="center")
fig.savefig("docs/q1-architecture.png",dpi=130,bbox_inches="tight",facecolor="white")
fig.savefig("docs/q1-architecture.svg",bbox_inches="tight",facecolor="white")
