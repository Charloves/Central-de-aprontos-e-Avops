/***********
 * WEB APP
 ***********/
function getHtmlFileContent_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function stripOuterScriptTag_(content) {
  return String(content || '')
    .replace(/^\s*<script[^>]*>\s*/i, '')
    .replace(/\s*<\/script>\s*$/i, '');
}

function getPdfJsSource() {
  const raw = getHtmlFileContent_('PdfJsLib');
  return stripOuterScriptTag_(raw);
}

function doGet(e) {
  const tokenParam = normalize_(e?.parameter?.token);
  const fallbackBaseUrl = getBaseWebAppUrl_(e?.parameter?.baseUrl);
  const avopIdParam = normalize_(e?.parameter?.avop);
  const avopAutoOpen = normalize_(e?.parameter?.auto);
  const avopReturnParams = {
    aba: normalize_(e?.parameter?.returnAba),
    id: normalize_(e?.parameter?.returnId),
    busca: normalize_(e?.parameter?.returnBusca),
    avopStatus: normalize_(e?.parameter?.returnAvopStatus)
  };
  const aprontoIdParam = normalize_(e?.parameter?.apronto);
  const maintenanceParam = normalize_(e?.parameter?.maintenance);
  const maintenanceKey = normalize_(e?.parameter?.key);
  const oiViewerParam = normalize_(e?.parameter?.oiviewer);
  const oiViewerAeronave = normalizeUpper_(e?.parameter?.aeronave);
  const oiViewerKey = normalize_(e?.parameter?.oi);
  const oiViewerPage = Number(e?.parameter?.page || 0);

  if (maintenanceParam === 'fill_oih50_pdf_fase_url') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = fillOiPhasePdfUrlsH50();
      return HtmlService.createHtmlOutput(JSON.stringify(result));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro de manutencao: ${String(err.message || err)}`);
    }
  }

  if (maintenanceParam === 'prepare_efetivo_perfis') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = prepararEfetivoPerfis();
      return HtmlService.createHtmlOutput(JSON.stringify(result));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro de manutencao: ${String(err.message || err)}`);
    }
  }

  if (maintenanceParam === 'atualizar_pendencias_avops') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = atualizarPendenciasAvops();
      return HtmlService.createHtmlOutput(JSON.stringify(result));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro de manutencao: ${String(err.message || err)}`);
    }
  }

  if (maintenanceParam === 'teste_email_cobranca_avop01_charles') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = testarEmailCobrancaAvop01Charles();
      return HtmlService.createHtmlOutput(JSON.stringify(result));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro no teste de e-mail: ${String(err.message || err)}`);
    }
  }

  if (maintenanceParam === 'listar_aliases_gmail') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = {
        ok: true,
        aliases: GmailApp.getAliases()
      };
      return HtmlService.createHtmlOutput(JSON.stringify(result));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro ao listar aliases: ${String(err.message || err)}`);
    }
  }

  if (maintenanceParam === 'criar_botao_divulgacao_avop') {
    if (maintenanceKey !== 'OIH50_FILL_20260331') {
      return HtmlService.createHtmlOutput('Chave de manutencao invalida.');
    }
    try {
      const result = criarBotaoDivulgacaoAvop();
      return HtmlService.createHtmlOutput(JSON.stringify({ ok: true, result }));
    } catch (err) {
      return HtmlService.createHtmlOutput(`Erro ao criar botao de divulgacao: ${String(err.message || err)}`);
    }
  }

  if (oiViewerParam === '1') {
    try {
      return renderOiViewerPage_(oiViewerAeronave, oiViewerKey, tokenParam, fallbackBaseUrl, oiViewerPage);
    } catch (err) {
      return HtmlService.createHtmlOutput(
        `Erro ao abrir o visualizador da OI: ${String(err.message || err)}`
      );
    }
  }

  if (avopIdParam) {
    return renderAvopPage_(avopIdParam, tokenParam, fallbackBaseUrl, avopAutoOpen, avopReturnParams);
  }

  if (aprontoIdParam) {
    return renderAprontoPage_(aprontoIdParam, tokenParam, fallbackBaseUrl);
  }

  const t = HtmlService.createTemplateFromFile('Portal');
  t.baseUrl = fallbackBaseUrl;

  return t.evaluate()
    .setTitle('Central Operacional')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
