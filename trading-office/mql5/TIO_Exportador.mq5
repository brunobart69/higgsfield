//+------------------------------------------------------------------+
//| TIO_Exportador.mq5                                               |
//| AI Trading Intelligence Office - exportador de indicadores       |
//|                                                                  |
//| SOMENTE LEITURA: este Expert Advisor NAO envia, altera ou fecha  |
//| ordens. Ele apenas copia os valores dos indicadores escolhidos   |
//| no painel do escritorio para arquivos CSV na pasta comum do MT5  |
//| (Files\TIO), de onde o escritorio os le.                         |
//+------------------------------------------------------------------+
#property copyright   "AI Trading Intelligence Office"
#property version     "1.10"
#property description "Exporta indicadores para o AI Trading Intelligence Office. Nao envia ordens."

input int IntervaloSegundos = 5;    // frequencia de exportacao (s)
input int Barras            = 600;  // barras fechadas exportadas

#define MAXBUF 8

string          g_ind[];
string          g_sym[];
string          g_tfn[];
ENUM_TIMEFRAMES g_tf[];
int             g_handle[];
datetime        g_last[];
string          g_cfg = "";
string          g_log = "";

ENUM_TIMEFRAMES TfFromName(string s)
  {
   if(s=="M1")  return PERIOD_M1;
   if(s=="M5")  return PERIOD_M5;
   if(s=="M15") return PERIOD_M15;
   if(s=="M30") return PERIOD_M30;
   if(s=="H1")  return PERIOD_H1;
   if(s=="H4")  return PERIOD_H4;
   if(s=="D1")  return PERIOD_D1;
   return PERIOD_CURRENT;
  }

string Safe(string s)
  {
   string r = s;
   StringReplace(r, "\\", "_");
   StringReplace(r, "/", "_");
   StringReplace(r, ":", "_");
   StringReplace(r, " ", "_");
   return r;
  }

void ReleaseAll()
  {
   for(int k = 0; k < ArraySize(g_handle); k++)
      if(g_handle[k] != INVALID_HANDLE)
         IndicatorRelease(g_handle[k]);
   ArrayResize(g_handle, 0);
   ArrayResize(g_last, 0);
  }

void LoadConfig()
  {
   int h = FileOpen("TIO\\config.txt", FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(h == INVALID_HANDLE)
      return;
   string all = "";
   while(!FileIsEnding(h))
      all += FileReadString(h) + "\n";
   FileClose(h);
   if(all == g_cfg)
      return;
   g_cfg = all;
   ReleaseAll();
   ArrayResize(g_ind, 0);
   ArrayResize(g_sym, 0);
   ArrayResize(g_tfn, 0);
   ArrayResize(g_tf, 0);
   string lines[];
   int n = StringSplit(all, '\n', lines);
   for(int i = 0; i < n; i++)
     {
      string ln = lines[i];
      StringTrimLeft(ln);
      StringTrimRight(ln);
      int p = StringFind(ln, "=");
      if(p <= 0)
         continue;
      string key = StringSubstr(ln, 0, p);
      string val = StringSubstr(ln, p + 1);
      if(StringLen(val) == 0)
         continue;
      if(key == "indicators")
         StringSplit(val, '|', g_ind);
      else
         if(key == "symbols")
            StringSplit(val, '|', g_sym);
         else
            if(key == "timeframes")
               StringSplit(val, '|', g_tfn);
     }
   int nt = ArraySize(g_tfn);
   ArrayResize(g_tf, nt);
   for(int t = 0; t < nt; t++)
      g_tf[t] = TfFromName(g_tfn[t]);
   int total = ArraySize(g_sym) * nt * ArraySize(g_ind);
   ArrayResize(g_handle, total);
   ArrayResize(g_last, total);
   g_log = "";
   int k = 0;
   for(int s = 0; s < ArraySize(g_sym); s++)
     {
      SymbolSelect(g_sym[s], true);
      for(int t = 0; t < nt; t++)
         for(int i = 0; i < ArraySize(g_ind); i++)
           {
            g_handle[k] = iCustom(g_sym[s], g_tf[t], g_ind[i]);
            g_last[k] = 0;
            if(g_handle[k] == INVALID_HANDLE)
               g_log += "ERRO ao carregar " + g_ind[i] + " em " + g_sym[s] + " " + g_tfn[t] + " (codigo " + IntegerToString(GetLastError()) + ")\n";
            k++;
           }
     }
  }

string Num(double v)
  {
   if(v == EMPTY_VALUE || !MathIsValidNumber(v))
      return "";
   return DoubleToString(v, 8);
  }

void ExportOne(int k, string sym, ENUM_TIMEFRAMES tf, string tfn, string ind)
  {
   int h = g_handle[k];
   if(h == INVALID_HANDLE || BarsCalculated(h) <= 0)
      return;
   int bars = MathMin(Barras, Bars(sym, tf) - 2);
   if(bars <= 10)
      return;
   datetime times[];
   if(CopyTime(sym, tf, 1, bars, times) != bars)
      return;
   double vals[];
   ArrayResize(vals, bars * MAXBUF);
   int nb = 0;
   double b[];
   for(int j = 0; j < MAXBUF; j++)
     {
      if(CopyBuffer(h, j, 1, bars, b) != bars)
         break;
      for(int i = 0; i < bars; i++)
         vals[i * MAXBUF + j] = b[i];
      nb++;
     }
   if(nb == 0)
      return;
   string fname = "TIO\\" + Safe(ind) + "_" + sym + "_" + tfn + ".csv";
   int fh = FileOpen(fname, FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(fh == INVALID_HANDLE)
      return;
   string head = "time";
   for(int j = 0; j < nb; j++)
      head += ",b" + IntegerToString(j);
   FileWriteString(fh, head + "\r\n");
   for(int i = 0; i < bars; i++)
     {
      string ln = IntegerToString((long)times[i]);
      for(int j = 0; j < nb; j++)
         ln += "," + Num(vals[i * MAXBUF + j]);
      FileWriteString(fh, ln + "\r\n");
     }
   FileClose(fh);
   // registro ao vivo da ultima barra fechada (detecta repaint)
   datetime lastbar = times[bars - 1];
   if(lastbar != g_last[k])
     {
      g_last[k] = lastbar;
      string lname = "TIO\\live_" + Safe(ind) + "_" + sym + "_" + tfn + ".csv";
      int lh = FileOpen(lname, FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
      if(lh != INVALID_HANDLE)
        {
         if(FileSize(lh) == 0)
            FileWriteString(lh, head + "\r\n");
         FileSeek(lh, 0, SEEK_END);
         string ln = IntegerToString((long)lastbar);
         for(int j = 0; j < nb; j++)
            ln += "," + Num(vals[(bars - 1) * MAXBUF + j]);
         FileWriteString(lh, ln + "\r\n");
         FileClose(lh);
        }
     }
  }

string Clean(string s)
  {
   string r = s;
   StringReplace(r, "\t", " ");
   StringReplace(r, "\r", " ");
   StringReplace(r, "\n", " ");
   return r;
  }

// Exporta os OBJETOS desenhados em todos os gráficos abertos (BOS, CHoCH, FVG, Order Block, Liquidez, POC...)
// e a lista de indicadores de cada gráfico. Somente leitura: nada é criado, alterado ou apagado.
void ExportObjects()
  {
   int fh = FileOpen("TIO\\objects.tsv", FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_UNICODE);
   int ch_h = FileOpen("TIO\\charts.tsv", FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_UNICODE);
   if(fh == INVALID_HANDLE || ch_h == INVALID_HANDLE)
     {
      if(fh != INVALID_HANDLE) FileClose(fh);
      if(ch_h != INVALID_HANDLE) FileClose(ch_h);
      return;
     }
   FileWriteString(fh, "chart\tsymbol\tperiod\tname\ttype\ttext\tt1\tp1\tt2\tp2\tcolor\r\n");
   FileWriteString(ch_h, "chart\tsymbol\tperiod\tindicators\r\n");
   long ch = ChartFirst();
   int guard = 0;
   while(ch >= 0 && guard < 100)
     {
      guard++;
      string sym = ChartSymbol(ch);
      int per = (int)ChartPeriod(ch);
      string inds = "";
      int wins = (int)ChartGetInteger(ch, CHART_WINDOWS_TOTAL);
      for(int w = 0; w < wins; w++)
         for(int j = 0; j < ChartIndicatorsTotal(ch, w); j++)
            inds += Clean(ChartIndicatorName(ch, w, j)) + "|";
      FileWriteString(ch_h, IntegerToString(ch) + "\t" + sym + "\t" + IntegerToString(per) + "\t" + inds + "\r\n");
      int total = ObjectsTotal(ch, -1, -1);
      int lim = MathMin(total, 3000);
      for(int i = 0; i < lim; i++)
        {
         string name = ObjectName(ch, i, -1, -1);
         ENUM_OBJECT tp = (ENUM_OBJECT)ObjectGetInteger(ch, name, OBJPROP_TYPE);
         if(tp == OBJ_LABEL || tp == OBJ_BUTTON || tp == OBJ_RECTANGLE_LABEL || tp == OBJ_EDIT || tp == OBJ_BITMAP_LABEL)
            continue;   // elementos de painel (coordenadas de tela, sem preço)
         string text = Clean(ObjectGetString(ch, name, OBJPROP_TEXT));
         long t1 = ObjectGetInteger(ch, name, OBJPROP_TIME, 0);
         double p1 = ObjectGetDouble(ch, name, OBJPROP_PRICE, 0);
         long t2 = 0;
         double p2 = 0;
         if(tp == OBJ_RECTANGLE || tp == OBJ_TREND || tp == OBJ_FIBO || tp == OBJ_ARROWED_LINE || tp == OBJ_CHANNEL)
           {
            t2 = ObjectGetInteger(ch, name, OBJPROP_TIME, 1);     // segundo ponto de ancoragem
            p2 = ObjectGetDouble(ch, name, OBJPROP_PRICE, 1);
           }
         long clr = ObjectGetInteger(ch, name, OBJPROP_COLOR);
         string lvls = "";
         if(tp == OBJ_FIBO)
           {
            int nl = (int)ObjectGetInteger(ch, name, OBJPROP_LEVELS);
            for(int k2 = 0; k2 < nl; k2++)
               lvls += DoubleToString(ObjectGetDouble(ch, name, OBJPROP_LEVELVALUE, k2), 3) + " ";
            text = text + " FIBO[" + lvls + "]";
           }
         FileWriteString(fh, IntegerToString(ch) + "\t" + sym + "\t" + IntegerToString(per) + "\t" + Clean(name) + "\t" +
                         EnumToString(tp) + "\t" + text + "\t" + IntegerToString(t1) + "\t" + DoubleToString(p1, 8) + "\t" +
                         IntegerToString(t2) + "\t" + DoubleToString(p2, 8) + "\t" + IntegerToString(clr) + "\r\n");
        }
      ch = ChartNext(ch);
     }
   FileClose(fh);
   FileClose(ch_h);
  }

void ExportAll()
  {
   ExportObjects();
   int nt = ArraySize(g_tf);
   int k = 0;
   for(int s = 0; s < ArraySize(g_sym); s++)
      for(int t = 0; t < nt; t++)
         for(int i = 0; i < ArraySize(g_ind); i++)
           {
            if(k < ArraySize(g_handle))
               ExportOne(k, g_sym[s], g_tf[t], g_tfn[t], g_ind[i]);
            k++;
           }
   int sh = FileOpen("TIO\\status.txt", FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(sh != INVALID_HANDLE)
     {
      FileWriteString(sh, "ativo=" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + "\r\n");
      FileWriteString(sh, "indicadores=" + IntegerToString(ArraySize(g_ind)) + " simbolos=" + IntegerToString(ArraySize(g_sym)) +
                      " temporalidades=" + IntegerToString(nt) + "\r\n");
      if(g_cfg == "")
         FileWriteString(sh, "Aguardando a escolha de indicadores no painel do escritorio.\r\n");
      FileWriteString(sh, g_log);
      FileClose(sh);
     }
  }

int OnInit()
  {
   FolderCreate("TIO", FILE_COMMON);
   LoadConfig();
   EventSetTimer(MathMax(1, IntervaloSegundos));
   Print("TIO_Exportador iniciado (somente leitura - nenhuma ordem e enviada).");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ReleaseAll();
  }

void OnTick() {}

void OnTimer()
  {
   LoadConfig();
   ExportAll();
  }
//+------------------------------------------------------------------+
