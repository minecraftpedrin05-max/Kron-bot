'use strict';

const db = require('../database/db');
const { precoParaFloat, floatParaPreco } = require('../sales-system/salesManager');

const DIA_MS = 24 * 60 * 60 * 1000;

const CONFIG_PADRAO = {
  ativado: true,
  recuperacaoAtiva: false,
  minutosAbandono: 60,
  mensagemRecuperacao: '🛒 Você iniciou uma compra recentemente, mas ainda não finalizou seu pedido. Se ainda tiver interesse, volte à loja pra concluir!',
  canalRelatorioId: null,
  alertasAtivo: false,
  alertasEnviados: {},
  meta: null,
};

function getConfigIntelligence(guildId) {
  const loja = db.getGuild(guildId).loja || {};
  return { ...CONFIG_PADRAO, ...(loja.intelligence || {}) };
}

function diasDesde(data) {
  return Math.floor((Date.now() - data.getTime()) / DIA_MS);
}

function carregarVendas(guildId) {
  const historico = db.getGuild(guildId).loja?.historicoCompras || [];
  return historico
    .map(h => ({ ...h, valorNum: precoParaFloat(h.valor), data: new Date(h.dataISO) }))
    .filter(v => !isNaN(v.data.getTime()));
}

function filtrarPorPeriodo(vendas, dias) {
  if (!dias || dias <= 0) return vendas;
  const limite = Date.now() - dias * DIA_MS;
  return vendas.filter(v => v.data.getTime() >= limite);
}

function filtrarPorIntervalo(vendas, desde, ate) {
  return vendas.filter(v => v.data.getTime() >= desde && v.data.getTime() < ate);
}

function resolverPeriodo(nome, opts) {
  opts = opts || {};
  const agora = Date.now();
  if (nome === 'hoje') {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    return { desde: inicio.getTime(), ate: agora, dias: 1, label: 'Hoje' };
  }
  if (nome === '7d') return { desde: agora - 7 * DIA_MS, ate: agora, dias: 7, label: 'Últimos 7 dias' };
  if (nome === '30d') return { desde: agora - 30 * DIA_MS, ate: agora, dias: 30, label: 'Últimos 30 dias' };
  if (nome === 'personalizado') {
    const dias = opts.dias && opts.dias > 0 ? opts.dias : 30;
    return { desde: agora - dias * DIA_MS, ate: agora, dias, label: `Últimos ${dias} dias` };
  }
  return { desde: agora - 30 * DIA_MS, ate: agora, dias: 30, label: 'Últimos 30 dias' };
}

function calcularConversao(guildId, dias) {
  const desdeISO = new Date(Date.now() - (dias || 30) * DIA_MS).toISOString();
  const carrinhos = db.getCarrinhosPorGuildDesde(guildId, desdeISO);
  if (carrinhos.length === 0) return null;

  const iniciados = carrinhos.length;
  const pixGerados = carrinhos.filter(c => ['pix_gerado', 'pago'].includes(c.status)).length;
  const pagos = carrinhos.filter(c => c.status === 'pago').length;
  const cancelados = carrinhos.filter(c => c.status === 'cancelado').length;
  const emAberto = iniciados - pagos - cancelados;

  return {
    iniciados, pixGerados, pagos, cancelados, emAberto,
    taxaConversao: iniciados > 0 ? (pagos / iniciados) * 100 : 0,
  };
}

function calcularDemandaPorProduto(guildId, dias) {
  const desdeISO = new Date(Date.now() - (dias || 30) * DIA_MS).toISOString();
  const carrinhos = db.getCarrinhosPorGuildDesde(guildId, desdeISO);
  const mapa = new Map();
  for (const c of carrinhos) {
    const chave = c.produto_nome || 'Desconhecido';
    const a = mapa.get(chave) || { produtoNome: chave, carrinhos: 0, pagos: 0, cancelados: 0 };
    a.carrinhos += 1;
    if (c.status === 'pago') a.pagos += 1;
    if (c.status === 'cancelado') a.cancelados += 1;
    mapa.set(chave, a);
  }
  return [...mapa.values()].map(p => ({ ...p, taxaConversao: p.carrinhos > 0 ? (p.pagos / p.carrinhos) * 100 : 0 }));
}

function resumoGeral(guildId, dias) {
  dias = dias || 30;
  const vendas = filtrarPorPeriodo(carregarVendas(guildId), dias);
  const config = getConfigIntelligence(guildId);
  const faturamento = vendas.reduce((a, v) => a + v.valorNum, 0);
  const clientesUnicos = new Set(vendas.map(v => v.clienteId)).size;
  const abandonados = db.listarCarrinhosAbandonados(guildId, config.minutosAbandono);
  const conversao = calcularConversao(guildId, dias);
  const ticketMedio = vendas.length > 0 ? faturamento / vendas.length : 0;

  return {
    dias,
    faturamento,
    faturamentoStr: floatParaPreco(faturamento),
    pedidosPagos: vendas.length,
    clientesUnicos,
    ticketMedio,
    ticketMedioStr: floatParaPreco(ticketMedio),
    carrinhosAbandonadosAgora: abandonados.length,
    conversao,
  };
}

function produtosRanking(guildId, dias, limite) {
  limite = limite || 5;
  const vendas = filtrarPorPeriodo(carregarVendas(guildId), dias || 30);
  const mapa = new Map();
  for (const v of vendas) {
    const chave = v.produtoNome || 'Desconhecido';
    const a = mapa.get(chave) || { produtoNome: chave, quantidade: 0, faturamento: 0 };
    a.quantidade += v.quantidade || 1;
    a.faturamento += v.valorNum;
    mapa.set(chave, a);
  }
  const lista = [...mapa.values()];
  if (lista.length === 0) return { maisVendidos: [], menosVendidos: [] };

  const porQtd = [...lista].sort((a, b) => b.quantidade - a.quantidade);
  return {
    maisVendidos: porQtd.slice(0, limite),
    menosVendidos: porQtd.length > limite ? porQtd.slice(-limite).reverse() : [],
  };
}

function crescimentoProdutos(guildId, janelaDias) {
  janelaDias = janelaDias || 15;
  const vendas = carregarVendas(guildId);
  const agora = Date.now();
  const inicioAtual = agora - janelaDias * DIA_MS;
  const inicioAnterior = agora - 2 * janelaDias * DIA_MS;

  const atual = filtrarPorIntervalo(vendas, inicioAtual, agora);
  const anterior = filtrarPorIntervalo(vendas, inicioAnterior, inicioAtual);

  if (atual.length === 0 && anterior.length === 0) return [];

  function agrupar(lista) {
    const m = new Map();
    for (const v of lista) {
      const chave = v.produtoNome || 'Desconhecido';
      m.set(chave, (m.get(chave) || 0) + (v.quantidade || 1));
    }
    return m;
  }

  const mapaAtual = agrupar(atual);
  const mapaAnterior = agrupar(anterior);
  const produtos = new Set([...mapaAtual.keys(), ...mapaAnterior.keys()]);

  const resultado = [];
  for (const nome of produtos) {
    const qtdAtual = mapaAtual.get(nome) || 0;
    const qtdAnterior = mapaAnterior.get(nome) || 0;
    if (qtdAtual === 0 && qtdAnterior === 0) continue;

    let variacaoPct = null;
    let tendencia = 'estavel';
    if (qtdAnterior === 0 && qtdAtual > 0) {
      tendencia = 'crescimento';
    } else if (qtdAnterior > 0) {
      variacaoPct = ((qtdAtual - qtdAnterior) / qtdAnterior) * 100;
      if (variacaoPct >= 20) tendencia = 'crescimento';
      else if (variacaoPct <= -20) tendencia = 'queda';
    }
    resultado.push({ produtoNome: nome, qtdAtual, qtdAnterior, variacaoPct, tendencia });
  }
  return resultado;
}

function estoqueBaixo(guildId, limite) {
  limite = limite || 3;
  const produtos = db.getProdutos(guildId);
  const alertas = [];
  for (const p of produtos) {
    if (!p.ativo) continue;
    const temVariantes = (p.variantes || []).length > 0;
    if (!temVariantes) {
      if (Array.isArray(p.estoque) && p.estoque.length > 0 && p.estoque.length <= limite) {
        alertas.push({ produtoNome: p.titulo, varianteNome: null, quantidade: p.estoque.length });
      }
    } else {
      for (const v of p.variantes) {
        if (typeof v.estoque === 'number' && v.estoque >= 0 && v.estoque <= limite) {
          alertas.push({ produtoNome: p.titulo, varianteNome: v.nome, quantidade: v.estoque });
        }
      }
    }
  }
  return alertas;
}

function cuponsResumo(guildId) {
  const produtos = db.getProdutos(guildId);
  const lista = [];
  for (const p of produtos) {
    for (const [codigo, c] of Object.entries(p.cupons || {})) {
      lista.push({
        codigo,
        produtoNome: p.titulo,
        usos: c.usos || 0,
        usosMaximos: c.usosMaximos || null,
        diasAtivo: c.criadoEm ? diasDesde(new Date(c.criadoEm)) : null,
      });
    }
  }
  return lista;
}

function gerarRecomendacoes({ guildId, minutosAbandono, vendas, produtos }) {
  const recs = [];

  const abandonados = db.listarCarrinhosAbandonados(guildId, minutosAbandono);
  if (abandonados.length >= 3) {
    recs.push({
      titulo: '🛒 Carrinhos abandonados', prioridade: '🔴 Alta',
      texto: `${abandonados.length} cliente(s) iniciaram uma compra e não concluíram (parado(s) há mais de ${minutosAbandono} min). Considere ativar a recuperação de carrinhos.`,
    });
  } else if (abandonados.length > 0) {
    recs.push({
      titulo: '🛒 Carrinhos abandonados', prioridade: '🟢 Baixa',
      texto: `${abandonados.length} carrinho(s) abandonado(s) no momento — volume baixo, mas já dá pra ativar a recuperação se quiser recuperar essas vendas específicas.`,
    });
  }

  const demanda = calcularDemandaPorProduto(guildId, 30);
  for (const p of produtos) {
    if (!p.ativo) continue;
    const d = demanda.find(x => x.produtoNome === p.titulo);
    const estoqueBaixoProd = (p.estoque?.length ?? null) !== null && p.estoque.length > 0 && p.estoque.length <= 3;
    if (estoqueBaixoProd && d && d.carrinhos >= 3) {
      recs.push({
        titulo: '📦 Estoque baixo com procura alta', prioridade: '🔴 Alta',
        texto: `**${p.titulo}** tem só ${p.estoque.length} unidade(s) em estoque e teve ${d.carrinhos} carrinho(s) iniciado(s) nos últimos 30 dias. Considere repor antes de perder vendas.`,
      });
    }
  }

  for (const d of demanda) {
    if (d.carrinhos >= 5 && d.taxaConversao < 30) {
      recs.push({
        titulo: '📉 Baixa conversão', prioridade: '🟠 Média',
        texto: `**${d.produtoNome}** teve ${d.carrinhos} carrinho(s) iniciado(s), mas só ${d.taxaConversao.toFixed(0)}% viraram venda. Considere revisar preço, descrição ou apresentação.`,
      });
    }
  }

  const crescimento = crescimentoProdutos(guildId, 15);
  for (const c of crescimento) {
    if (c.tendencia === 'queda') {
      recs.push({
        titulo: '⚠️ Queda nas vendas', prioridade: '🟠 Média',
        texto: `**${c.produtoNome}** caiu de ${c.qtdAnterior} para ${c.qtdAtual} venda(s) nos últimos 15 dias em relação aos 15 dias anteriores.`,
      });
    } else if (c.tendencia === 'crescimento' && c.qtdAtual >= 3) {
      recs.push({
        titulo: '📈 Produto em crescimento', prioridade: '🟢 Baixa',
        texto: `**${c.produtoNome}** foi de ${c.qtdAnterior} para ${c.qtdAtual} venda(s) nos últimos 15 dias. Pode valer destacar mais esse produto.`,
      });
    }
  }

  for (const c of cuponsResumo(guildId)) {
    if (c.usos === 0 && c.diasAtivo != null && c.diasAtivo >= 14) {
      recs.push({
        titulo: '🎟️ Cupom sem uso', prioridade: '🟢 Baixa',
        texto: `O cupom \`${c.codigo}\` (${c.produtoNome}) existe há ${c.diasAtivo} dias e nunca foi usado. Considere divulgar mais ou revisar a estratégia dele.`,
      });
    }
  }

  if (recs.length === 0) {
    recs.push({
      titulo: '✅ Sem alertas no momento', prioridade: '🟢 Baixa',
      texto: vendas.length === 0
        ? 'Ainda não há dados suficientes — volte aqui depois das primeiras vendas.'
        : 'Os dados atuais não mostram nenhum ponto de atenção forte o suficiente pra recomendar algo com segurança.',
    });
  }

  return recs;
}

const PESO_PRIORIDADE = { '🔴 Alta': 0, '🟠 Média': 1, '🟢 Baixa': 2 };

function proximasAcoes(recomendacoes, limite) {
  limite = limite || 3;
  return [...recomendacoes]
    .sort((a, b) => (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9))
    .slice(0, limite);
}

// ── Alertas automáticos (Parte 4) ───────────────────────────────────────
// Função pura: só lê e retorna candidatos a alerta. Não envia nada, não
// sabe de cooldown/anti-spam — isso é responsabilidade de quem chama
// (insights-system/alertScheduler.js), que decide se já foi enviado
// recentemente antes de disparar. Cada alerta tem uma `chave` estável
// (mesmo tipo + mesmo produto = mesma chave sempre) pra permitir dedupe.
function detectarAlertas(guildId) {
  const alertas = [];
  const produtos = db.getProdutos(guildId);
  const vendas30 = filtrarPorPeriodo(carregarVendas(guildId), 30);

  for (const p of produtos) {
    if (!p.ativo) continue;
    const temVariantes = (p.variantes || []).length > 0;

    function avaliarEstoque(qtd, rotulo) {
      if (typeof qtd !== 'number' || qtd < 0) return;
      if (qtd <= 1) {
        alertas.push({
          tipo: 'estoque_critico', chave: `estoque_critico:${p.titulo}:${rotulo || ''}`,
          prioridade: '🔴 Alta', titulo: '📦 Estoque crítico',
          texto: `**${p.titulo}**${rotulo ? ` (${rotulo})` : ''} está com só ${qtd} unidade(s) em estoque.`,
        });
      } else if (qtd <= 3) {
        alertas.push({
          tipo: 'estoque_baixo', chave: `estoque_baixo:${p.titulo}:${rotulo || ''}`,
          prioridade: '🟠 Média', titulo: '📦 Estoque baixo',
          texto: `**${p.titulo}**${rotulo ? ` (${rotulo})` : ''} está com ${qtd} unidades em estoque.`,
        });
      }
    }

    if (!temVariantes) {
      if (Array.isArray(p.estoque)) avaliarEstoque(p.estoque.length, null);
    } else {
      for (const v of p.variantes) avaliarEstoque(v.estoque, v.nome);
    }

    if (p.criadoEm && diasDesde(new Date(p.criadoEm)) >= 14) {
      const teveVenda = vendas30.some(v => v.produtoNome === p.titulo);
      if (!teveVenda) {
        alertas.push({
          tipo: 'sem_vendas', chave: `sem_vendas:${p.titulo}`,
          prioridade: '🟡 Atenção', titulo: '💤 Produto sem vendas',
          texto: `**${p.titulo}** não teve nenhuma venda nos últimos 30 dias.`,
        });
      }
    }
  }

  for (const c of crescimentoProdutos(guildId, 15)) {
    if (c.tendencia === 'crescimento' && c.qtdAtual >= 3) {
      alertas.push({
        tipo: 'crescimento', chave: `crescimento:${c.produtoNome}`,
        prioridade: '🟢 Baixa', titulo: '📈 Produto em crescimento',
        texto: `**${c.produtoNome}** foi de ${c.qtdAnterior} para ${c.qtdAtual} venda(s) nos últimos 15 dias (vs 15 dias anteriores).`,
      });
    } else if (c.tendencia === 'queda') {
      alertas.push({
        tipo: 'queda', chave: `queda:${c.produtoNome}`,
        prioridade: '🟠 Média', titulo: '⚠️ Queda nas vendas',
        texto: `**${c.produtoNome}** caiu de ${c.qtdAnterior} para ${c.qtdAtual} venda(s) nos últimos 15 dias (vs 15 dias anteriores).`,
      });
    }
  }

  const config = getConfigIntelligence(guildId);
  const abandonados = db.listarCarrinhosAbandonados(guildId, config.minutosAbandono);
  if (abandonados.length >= 5) {
    alertas.push({
      tipo: 'carrinhos_abandonados', chave: 'carrinhos_abandonados',
      prioridade: '🟠 Média', titulo: '🛒 Muitos carrinhos abandonados',
      texto: `${abandonados.length} carrinho(s) parado(s) há mais de ${config.minutosAbandono} min sem concluir a compra.`,
    });
  }

  const desde7dISO = new Date(Date.now() - 7 * DIA_MS).toISOString();
  const pendentes = db.getCarrinhosPorGuildDesde(guildId, desde7dISO).filter(c => {
    if (c.status !== 'pix_gerado') return false;
    const minutosParado = (Date.now() - new Date(c.atualizado_em).getTime()) / 60000;
    return minutosParado >= config.minutosAbandono;
  });
  if (pendentes.length >= 3) {
    alertas.push({
      tipo: 'pagamentos_pendentes', chave: 'pagamentos_pendentes',
      prioridade: '🟠 Média', titulo: '⏳ Muitos pagamentos pendentes',
      texto: `${pendentes.length} PIX gerado(s) sem confirmação de pagamento há mais de ${config.minutosAbandono} min.`,
    });
  }

  return alertas;
}

// ── Metas de vendas (Parte 5) ────────────────────────────────────────────
// A meta é um período fixo (não rolante): começa em meta.criadaEm e dura
// meta.dias dias. Faturamento contado é só o que caiu dentro dessa janela
// — igual a qualquer relatório de meta real (não é "últimos N dias a
// partir de agora", senão a meta nunca fecharia).
function calcularProgressoMeta(guildId) {
  const config = getConfigIntelligence(guildId);
  const meta = config.meta;
  if (!meta || !meta.valor || !meta.dias || !meta.criadaEm) return null;

  const inicio = new Date(meta.criadaEm).getTime();
  const fim = inicio + meta.dias * DIA_MS;
  const agora = Date.now();

  const vendas = carregarVendas(guildId).filter(v => {
    const t = v.data.getTime();
    return t >= inicio && t <= Math.min(agora, fim);
  });
  const alcancado = vendas.reduce((a, v) => a + v.valorNum, 0);
  const percentualReal = meta.valor > 0 ? (alcancado / meta.valor) * 100 : 0;
  const percentual = Math.min(100, Math.max(0, percentualReal));
  const restante = Math.max(0, meta.valor - alcancado);
  const diasRestantes = Math.max(0, Math.ceil((fim - agora) / DIA_MS));
  const expirada = agora > fim;
  const atingida = alcancado >= meta.valor;
  const mediaDiariaNecessaria = (!atingida && diasRestantes > 0) ? restante / diasRestantes : null;

  return {
    valor: meta.valor, dias: meta.dias, criadaEm: meta.criadaEm,
    alcancado, percentual, percentualReal, restante, diasRestantes, expirada, atingida,
    mediaDiariaNecessaria,
    valorStr: floatParaPreco(meta.valor),
    alcancadoStr: floatParaPreco(alcancado),
    restanteStr: floatParaPreco(restante),
    mediaDiariaStr: mediaDiariaNecessaria != null ? floatParaPreco(mediaDiariaNecessaria) : null,
  };
}

module.exports = {
  DIA_MS,
  getConfigIntelligence,
  diasDesde,
  carregarVendas,
  filtrarPorPeriodo,
  filtrarPorIntervalo,
  resolverPeriodo,
  calcularConversao,
  calcularDemandaPorProduto,
  resumoGeral,
  produtosRanking,
  crescimentoProdutos,
  estoqueBaixo,
  cuponsResumo,
  gerarRecomendacoes,
  proximasAcoes,
  detectarAlertas,
  calcularProgressoMeta,
};

