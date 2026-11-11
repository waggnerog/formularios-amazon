# HARALD — Contrato operacional do Console Horistas

Atualizado em 11/11/2026. Documento de referência consolidado a partir das decisões dos chats do projeto GENIALE | HARALD.

## Fonte e escopo

- Fonte de verdade: **Controle Operacional Horistas.xlsx**, aba **Controle Operacional**, mantida pelo chat **CONTROLE OPERACIONAL**.
- A Library pode substituir o `library_file_id` da versão anterior. Localizar também pelo **nome exato**, selecionar a modificação mais recente e comparar checksum e conteúdo.
- Escopo exclusivo da visualização: **HORISTA**, cenário **C2**, setores do padrão **GH2-UF-###**. Não misturar CLT ou dados das abas Promotores/Setores Total na contagem de lojas do Console.
- Sincronização: arquivo → validação da aba → `public.harald_publish_horista_source` (Supabase `mcditxbuemxlaewyuwlw`) → `harald_horista_console_rows` → Console.
- Em erro ou divergência estrutural, **não substituir** a versão publicada.

## As oito perguntas operacionais

1. Onde há setores e lojas? Região → UF → cidade → setor → loja.
2. Quais setores têm promotor e quais estão vagos? **ATIVO** quando o setor tem nome de promotor vinculado; **VAGA OPEN** quando não tem.
3. Quem é cada promotor e como contatá-lo? Uma **pessoa única** por nome normalizado, telefone/WhatsApp, todos os setores e lojas vinculados.
4. Quais lojas pertencem a cada setor/promotor? CNPJ, bandeira, nome, cidade/UF, endereço **da loja**, prioridade, horas e dias do roteiro.
5. Como estão os roteiros? Semana 1/2, dias e quantidade de visitas **planejadas**; sem afirmar presença.
6. Qual é a carga por setor e por promotor? Visitas programadas, horas de atendimento, deslocamento e capacidade; não somar a carga total do setor uma vez por loja.
7. Onde estão as pendências? Vagas abertas, sem promotor, sem WhatsApp, cadastro pendente e informações faltantes.
8. Qual é a efetividade? Programadas versus realizadas e médias por promotor **somente se houver fonte de execução válida**; caso contrário, mostrar "sem dados de realização".

## Regras para os indicadores e para o mapa

- **Lojas** = quantidade de linhas distintas da aba Controle Operacional; uma linha por loja.
- **Setores** = `COUNT(DISTINCT sector_code)`, não contar cada loja como novo setor.
- **Setores ativos** = setores distintos com pelo menos um `PROMOTOR` não vazio.
- **Vagas abertas** = setores totais menos setores ativos.
- **Promotores únicos** = nomes normalizados distintos, evitando linhas duplicadas para várias lojas e setores.
- **Lojas com promotor informado** = linhas individuais em que `PROMOTOR` está preenchido. **Não é** a mesma métrica que setores ativos.
- Exibir no mapa `setores ativos / setores totais` por UF. Dentro da UF, distinguir também `lojas com promotor / lojas totais`, com aba Setores, Lojas e Promotores e filtros Todos/ATIVO/VAGA OPEN/Pendências cadastrais.
- Rótulos de status no Console têm **apenas ATIVO e VAGA OPEN**, conforme decisão mais recente. Status histórico da planilha (`EM ADMISSÃO`, `FECHADO`, `CONTRATADO`, `VAGA ABERTA`) permanece na origem e não determina ocupação.
- `VAGA ABERTA` é alias de `VAGA OPEN` e `FECHADO` de `CONTRATADO` **apenas na normalização do campo de origem**; vazio permanece não informado no banco.
- **Visitas realizadas** não podem ser derivadas dos dias da sistemática, de `TOTAL VISITAS 1ª SEM` ou dos nomes cadastrados. São medidas distintas.

## Privacidade e acesso

- Informações operacionais permitidas no Console: nome profissional, WhatsApp de trabalho, setores e lojas, roteiros, dados **da loja**, pendências operacionais.
- CPF, RG, dados bancários, PIX, data de nascimento e endereço **pessoal** ficam somente em `harald_horista_private_rows`, com leitura restrita ao papel administrativo via RLS. Nunca incluir tais dados em HTML, bundles, logs públicos ou JSON operacional.
- Cadastro e alterações de vínculo ocorrem na **fonte oficial**, não no Console. O Console é leitura operacional; anotações de acompanhamento permanecem separadas do cadastro.
- Cada setor possui identidade permanente para histórico e substituições; um profissional pode ocupar múltiplos setores. Histórico não pode ser reconstruído ficticiamente só a partir da fotografia atual da planilha.

## Referência de validação (arquivo auditado 11/11/2026)

- 391 lojas (38 linhas com promotor), 203 setores GH2, 17 setores ativos, 186 vagas abertas e 10 promotores únicos.
- Rio Grande do Sul: 34 setores (12 ativos e 22 abertos), 72 lojas (17 linhas com promotor) e 8 profissionais únicos.
- Sem dados reais de execução publicados nas tabelas `harald_actual_imports` e `harald_visit_actuals` na auditoria.
- Os números acima são **fotografia de referência**, não valores fixos do produto. O Console deve sempre calcular dinamicamente na fonte publicada.

## Critérios mínimos de regressão

1. Um promotor em cinco setores aparece uma vez na lista Promotores e exibe cinco setores, todas as lojas e os roteiros nos detalhes.
2. Uma loja a mais em setor já existente incrementa lojas, **não** setores.
3. Texto de vaga "VAGA OPEN" com nome de promotor deve aparecer como **ATIVO** no painel, sem alterar o texto bruto da fonte.
4. Setor sem promotor deve aparecer como **VAGA OPEN** mesmo com status de origem vazio.
5. RS permanece 12/34 setores e 17/72 lojas para o snapshot acima.
6. Nenhuma informação privada entra na tabela de Console ou no repositório.
7. Falha de importação impede publicação parcial ou mutação silenciosa.
