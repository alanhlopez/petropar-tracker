import pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt, matplotlib.dates as mdates, matplotlib.ticker as mt
raw=pd.read_csv("petropar_precios.csv",parse_dates=["fecha"]).set_index("fecha")
cols={"diesel_mbarete":("Diésel Mbarete","#2a78d6"),"diesel_pora":("Diésel Porã","#eb6834"),
"nafta_aratiri97":("Aratiri 97","#1baf7a"),"nafta_oikoite93":("Oikoite 93","#eda100"),"nafta_kape88":("Kape 88","#e87ba4")}
start=pd.Timestamp("2016-08-01"); end=pd.Timestamp("2026-10-31")
df=raw[list(cols)].ffill()
df.loc[end]=df.iloc[-1]
w=pd.read_csv("wti.csv",parse_dates=["Date"]).set_index("Date")["Price"]
w=w[start:].resample("MS").mean()/42
pres=[("Horacio Cartes","2016-08-01","2018-08-15"),("Mario Abdo Benítez","2018-08-15","2023-08-15"),("Santiago Peña","2023-08-15","2026-10-31")]
bg="#fcfcfb"
fig,ax=plt.subplots(figsize=(18,10),dpi=110); fig.patch.set_facecolor(bg); ax.set_facecolor(bg)
for i,(n,s,e) in enumerate(pres):
    s,e=pd.Timestamp(s),pd.Timestamp(e)
    ax.text(s+(e-s)/2,1.012,n,transform=ax.get_xaxis_transform(),ha="center",va="bottom",fontsize=11 if n!="Franco" else 9.5,color="#52514e",fontweight="bold",linespacing=1.1)
for sp in ["top","left","right"]: ax.spines[sp].set_visible(False)
ax.spines["bottom"].set_color("#b5b3ad"); ax.grid(axis="y",color="#dcdad5",lw=0.8)
ax.tick_params(colors="#52514e",labelsize=11.5,length=0)
# oil on right axis (behind fuel lines)
ax2=ax.twinx(); ax2.set_zorder(1); ax.set_zorder(2); ax.patch.set_visible(False); ax2.patch.set_visible(False)
for i,(n,s_,e_) in enumerate(pres):
    ax2.axvspan(pd.Timestamp(s_),pd.Timestamp(e_),color=["#f3f2ee","#e6e5e0"][i%2],zorder=0,lw=0)
ax2.plot(w.index,w.values,color="#1f1f1d",lw=4,linestyle=(0,(0.1,2.2)),dash_capstyle="round")
ax2.set_ylim(0,3.6); ax2.set_ylabel("")
ax2.yaxis.set_major_formatter(mt.FuncFormatter(lambda x,p:f"US$ {x:.1f}".replace(".",",")))
for sp in ["top","left","right","bottom"]: ax2.spines[sp].set_visible(False)
ax2.tick_params(colors="#3d3c39",labelsize=11.5,length=0)
for c,(lab,col) in cols.items():
    ax.step(df.index,df[c],where="post",color=col,lw=2.3,zorder=3)
ends={"diesel_mbarete":11395,"diesel_pora":9285+170,"nafta_aratiri97":8990-170,"nafta_oikoite93":7490,"nafta_kape88":6990-100}
for c,(lab,col) in cols.items():
    ax.annotate("━",(end,ends[c]),xytext=(66,0),textcoords="offset points",va="center",fontsize=14,color=col,annotation_clip=False,fontweight="bold")
    ax.annotate(f"{lab}  {df[c].iloc[-1]:,.0f}".replace(",","."),(end,ends[c]),xytext=(88,0),textcoords="offset points",va="center",fontsize=12,color="#0b0b0b",annotation_clip=False)
# oil end label
ax.annotate("•••",(end,w.iloc[-1]*12600/3.6),xytext=(62,0),textcoords="offset points",va="center",fontsize=12,color="#1f1f1d",annotation_clip=False,fontweight="bold")
ax.annotate(f"WTI  US$ {w.iloc[-1]:.2f}/gal".replace(".",","),(end,w.iloc[-1]*12600/3.6),xytext=(88,0),va="center",textcoords="offset points",fontsize=12,color="#3d3c39",fontweight="bold",annotation_clip=False)
# move fuel labels outside to right of right axis ticks

for d,lab in [("2020-03-11","Inicio pandemia\n(OMS, 11/03/2020)"),("2023-05-05","Fin emergencia\n(OMS, 05/05/2023)")]:
    d=pd.Timestamp(d)
    ax.axvline(d,color="#7a1f1f",lw=1.6,ls=(0,(6,4)),zorder=2.5)
    ax.text(d,12350,lab,ha="center",va="top",fontsize=10.5,color="#7a1f1f",fontweight="bold",zorder=6,bbox=dict(fc=bg,ec="none",pad=2))
ax.set_ylabel("Combustibles Petropar · Guaraníes por litro",color="#52514e",fontsize=12.5)
ax.yaxis.set_major_formatter(mt.FuncFormatter(lambda x,p:f"{x:,.0f}".replace(",",".")))
ax.set_ylim(0,12600)
ax.xaxis.set_major_locator(mdates.YearLocator(1)); ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
ax.set_xlim(start,end)
fig.text(0.05,0.965,"Precios de combustibles de Petropar y precio del petróleo, 2016–2026",fontsize=21,fontweight="bold",color="#0b0b0b")
fig.text(0.05,0.937,"Eje izquierdo: precio de surtidor Petropar (Gs/litro, nominal, planta Villa Elisa). Eje derecho: crudo WTI en US$ por galón (promedio mensual). Sombreado: período presidencial. Líneas verticales: pandemia COVID-19.",fontsize=12,color="#52514e")
fig.text(0.05,0.012,"Fuente: Petropar vía prensa (ABC, La Nación, Última Hora, IP, La Tribuna, El Nacional, 1000 Noticias) y planilla propia; WTI: EIA (datasets/oil-prices).\nRed de estaciones Petropar desde ~2016; 2016–2017 con pocas fechas documentadas. Algunos tramos 2022–2023 y feb-2026 son derivados de montos de baja/suba.\nPrecios nominales, sin ajuste por inflación ni tipo de cambio. Las escalas de ambos ejes son independientes: no comparar alturas entre líneas de distinto eje. Último dato: 28/10/2026 (WTI al 20/10/2026).",fontsize=10,color="#7a7974")
plt.subplots_adjust(left=0.06,right=0.76,top=0.865,bottom=0.105)
# push fuel labels beyond right axis ticks
for t in ax.texts: pass
fig.savefig("petropar_vs_wti_2016_2026.png",facecolor=bg)
