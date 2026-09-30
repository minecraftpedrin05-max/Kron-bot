// ============================================================
//  payment-system/PaymentProvider.js — Contrato comum de provider
//  de pagamento (KAEL)
//
//  TAREFA 6 (Parte 1): apenas arquitetura, SEM nenhum código
//  fictício da API da OpenPix/Woovi. Nenhum endpoint, payload,
//  header ou evento da OpenPix é inventado aqui — a integração
//  real (Parte 2) deve seguir a documentação oficial:
//    https://developers.openpix.com.br/
//    https://developers.woovi.com/
//
//  Este arquivo só formaliza, como uma interface, o padrão que
//  mercadoPago.js / efiBank.js / c6Bank.js JÁ seguem hoje
//  (cada um isoladamente):
//    - criarPagamentoPix({ valor, descricao, clienteId, guildId, ... })
//        → { id, status: 'approved' | 'pending' | 'cancelled', ... }
//    - consultarPagamento(id, cfg)
//        → { status: 'approved' | 'pending' | 'cancelled', ... }
//    - getConfig(guildId)
//        → configuração isolada por servidor (mesmo padrão de
//          getConfigMercadoPago / getConfigC6Bank / getConfigEfiBank)
//
//  Um provider novo (ex.: OpenPix) implementa esta mesma forma e
//  é conectado no fluxo de checkout/webhook exatamente como os
//  outros três já são — sem espalhar `if (provider === 'openpix')`
//  pelo projeto inteiro.
// ============================================================

/**
 * @typedef {'approved'|'pending'|'cancelled'} StatusPagamento
 * (mesmo vocabulário já normalizado em mercadoPago.js/efiBank.js/c6Bank.js)
 */

class PaymentProvider {
  /** Identificador curto do provider (ex.: 'MERCADO_PAGO', 'EFI', 'C6', 'OPENPIX'). */
  get nome() {
    throw new Error('PaymentProvider.nome não implementado.');
  }

  /**
   * Cria uma cobrança PIX.
   * @returns {Promise<{ id: string, status: StatusPagamento, copiaECola?: string, qrCodeBase64?: string|null }>}
   */
  async criarPagamentoPix(_dados) {
    throw new Error(`${this.nome}: criarPagamentoPix() não implementado.`);
  }

  /**
   * Consulta o status oficial de uma cobrança já criada.
   * NUNCA deve ser substituído por um sinal indireto (clique do
   * usuário, aviso no Discord, etc.) — ver TAREFA 3.
   * @returns {Promise<{ status: StatusPagamento }>}
   */
  async consultarPagamento(_id, _cfg) {
    throw new Error(`${this.nome}: consultarPagamento() não implementado.`);
  }

  /** Configuração isolada por guildId (nunca compartilhada entre servidores). */
  getConfig(_guildId) {
    throw new Error(`${this.nome}: getConfig() não implementado.`);
  }
}

// ── Registro simples de providers disponíveis ────────────────
// Preparação para a Parte 2: quando o provider OpenPix for
// implementado (seguindo a documentação oficial), ele se registra
// aqui como qualquer outro — nenhuma lógica nova precisa ser
// espalhada pelo checkout, webhook ou carteira.
const _providers = new Map();

function registrarProvider(nome, instancia) {
  _providers.set(nome, instancia);
}

function obterProvider(nome) {
  return _providers.get(nome) || null;
}

module.exports = { PaymentProvider, registrarProvider, obterProvider };
