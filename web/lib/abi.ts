//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// DeClubEscrow
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const deClubEscrowAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'initialFee', internalType: 'uint256', type: 'uint256' },
      { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
      { name: 'feeRecipient', internalType: 'address', type: 'address' },
      { name: 'admin', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_APPLY_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_RAISE_DELAY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_RECIPIENT',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_ASSETS_PER_SIDE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_LIMIT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_NFTS_PER_SIDE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_NOTE_BYTES',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_SPEC_BYTES',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'acceptFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'acceptProposal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'applyFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'cancelTrade',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'assetType',
        internalType: 'enum IDeClubEscrow.AssetType',
        type: 'uint8',
      },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      {
        name: 'assetType',
        internalType: 'enum IDeClubEscrow.AssetType',
        type: 'uint8',
      },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'claimable',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'offered',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'taker', internalType: 'address', type: 'address' },
      { name: 'expiry', internalType: 'uint64', type: 'uint64' },
      { name: 'note', internalType: 'string', type: 'string' },
    ],
    name: 'createOpenOffer',
    outputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'offered',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      {
        name: 'requested',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'taker', internalType: 'address', type: 'address' },
      { name: 'expiry', internalType: 'uint64', type: 'uint64' },
    ],
    name: 'createTrade',
    outputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'offered',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      {
        name: 'requested',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'taker', internalType: 'address', type: 'address' },
      { name: 'expiry', internalType: 'uint64', type: 'uint64' },
      { name: 'spec', internalType: 'string', type: 'string' },
    ],
    name: 'createTraitTrade',
    outputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'assets',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'feeUnits',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'fillTrade',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'fills',
        internalType: 'struct IDeClubEscrow.TraitFill[]',
        type: 'tuple[]',
        components: [
          { name: 'tokenIds', internalType: 'uint256[]', type: 'uint256[]' },
          { name: 'proofs', internalType: 'bytes32[][]', type: 'bytes32[][]' },
        ],
      },
    ],
    name: 'fillTraitTrade',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getProposal',
    outputs: [
      {
        name: '',
        internalType: 'struct IDeClubEscrow.Proposal',
        type: 'tuple',
        components: [
          { name: 'proposer', internalType: 'address', type: 'address' },
          {
            name: 'status',
            internalType: 'enum IDeClubEscrow.ProposalStatus',
            type: 'uint8',
          },
          {
            name: 'assets',
            internalType: 'struct IDeClubEscrow.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubEscrow.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getProposals',
    outputs: [
      {
        name: 'page',
        internalType: 'struct IDeClubEscrow.Proposal[]',
        type: 'tuple[]',
        components: [
          { name: 'proposer', internalType: 'address', type: 'address' },
          {
            name: 'status',
            internalType: 'enum IDeClubEscrow.ProposalStatus',
            type: 'uint8',
          },
          {
            name: 'assets',
            internalType: 'struct IDeClubEscrow.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubEscrow.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'getTrade',
    outputs: [
      {
        name: '',
        internalType: 'struct IDeClubEscrow.Trade',
        type: 'tuple',
        components: [
          { name: 'maker', internalType: 'address', type: 'address' },
          { name: 'expiry', internalType: 'uint64', type: 'uint64' },
          {
            name: 'status',
            internalType: 'enum IDeClubEscrow.Status',
            type: 'uint8',
          },
          { name: 'taker', internalType: 'address', type: 'address' },
          { name: 'fee', internalType: 'uint96', type: 'uint96' },
          {
            name: 'offered',
            internalType: 'struct IDeClubEscrow.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubEscrow.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'requested',
            internalType: 'struct IDeClubEscrow.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubEscrow.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'isExpired',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'offerNote',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFeeAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFeeAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'assets',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'propose',
    outputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'reclaimExpired',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'rejectProposal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFee', internalType: 'uint256', type: 'uint256' }],
    name: 'setFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tradeCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'traitSpec',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'next', internalType: 'address', type: 'address' }],
    name: 'transferFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdrawProposal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'assetType',
        internalType: 'enum IDeClubEscrow.AssetType',
        type: 'uint8',
        indexed: false,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'AssetCredited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'assetType',
        internalType: 'enum IDeClubEscrow.AssetType',
        type: 'uint8',
        indexed: false,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Claimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'current',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'FeeAdminTransferStarted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previous',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'FeeAdminTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'effectiveAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeChangeQueued',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeCharged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'note', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'OfferNote',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProposalAccepted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'proposer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'assets',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        indexed: false,
      },
    ],
    name: 'ProposalCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProposalRejected',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'ProposalWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TradeCancelled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'taker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'offered',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        indexed: false,
      },
      {
        name: 'requested',
        internalType: 'struct IDeClubEscrow.Asset[]',
        type: 'tuple[]',
        components: [
          {
            name: 'assetType',
            internalType: 'enum IDeClubEscrow.AssetType',
            type: 'uint8',
          },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        indexed: false,
      },
      {
        name: 'expiry',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'TradeCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'taker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TradeFilled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'caller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TradeReclaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tradeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'spec', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'TraitSpec',
  },
  {
    type: 'error',
    inputs: [
      { name: 'length', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'BadTraitSpec',
  },
  { type: 'error', inputs: [], name: 'ClaimFailed' },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'DuplicateAsset',
  },
  { type: 'error', inputs: [], name: 'EmptySide' },
  {
    type: 'error',
    inputs: [{ name: 'expiry', internalType: 'uint64', type: 'uint64' }],
    name: 'ExpiryInPast',
  },
  {
    type: 'error',
    inputs: [{ name: 'effectiveAt', internalType: 'uint256', type: 'uint256' }],
    name: 'FeeRaiseExpired',
  },
  {
    type: 'error',
    inputs: [{ name: 'effectiveAt', internalType: 'uint256', type: 'uint256' }],
    name: 'FeeRaiseNotReady',
  },
  {
    type: 'error',
    inputs: [
      { name: 'fee', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FeeTooHigh',
  },
  {
    type: 'error',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidAsset',
  },
  {
    type: 'error',
    inputs: [{ name: 'fillIndex', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidTraitFill',
  },
  {
    type: 'error',
    inputs: [
      { name: 'fillIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidTraitProof',
  },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NftNotReceived',
  },
  { type: 'error', inputs: [], name: 'NoFeeRecipient' },
  { type: 'error', inputs: [], name: 'NoPendingFee' },
  { type: 'error', inputs: [], name: 'NoTraitAsset' },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'NotAllowedTaker',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotFeeAdmin',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'NotMaker',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'NotOpenOffer',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotPendingFeeAdmin',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NotProposer',
  },
  {
    type: 'error',
    inputs: [
      { name: 'length', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NoteTooLong',
  },
  { type: 'error', inputs: [], name: 'NothingToClaim' },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'OpenOfferNoFill',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ProposalNotActive',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  {
    type: 'error',
    inputs: [
      { name: 'offeredIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'requestedIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SameAssetBothSides',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'SelfFill',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'SelfPropose',
  },
  {
    type: 'error',
    inputs: [
      { name: 'count', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'TooManyAssets',
  },
  {
    type: 'error',
    inputs: [
      { name: 'count', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'TooManyNfts',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'TradeIsExpired',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'TradeNotExpired',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'TradeNotOpen',
  },
  {
    type: 'error',
    inputs: [{ name: 'tradeId', internalType: 'uint256', type: 'uint256' }],
    name: 'TraitFillRequired',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tradeId', internalType: 'uint256', type: 'uint256' },
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'UnknownProposal',
  },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'UnsupportedToken',
  },
  {
    type: 'error',
    inputs: [
      { name: 'expected', internalType: 'uint256', type: 'uint256' },
      { name: 'sent', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'WrongNativeAmount',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// DeClubIntents
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const deClubIntentsAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'feeToken', internalType: 'address', type: 'address' },
      { name: 'initialFee', internalType: 'uint256', type: 'uint256' },
      { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
      { name: 'feeRecipient', internalType: 'address', type: 'address' },
      { name: 'admin', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_APPLY_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_RAISE_DELAY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_RECIPIENT',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_TOKEN',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_ASSETS_PER_SIDE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CYCLE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_LIMIT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_NFTS_PER_SIDE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'acceptFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'applyFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'intent',
        internalType: 'struct IDeClubIntents.Intent',
        type: 'tuple',
        components: [
          { name: 'maker', internalType: 'address', type: 'address' },
          {
            name: 'give',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'want',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          { name: 'feeToken', internalType: 'address', type: 'address' },
          { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
          { name: 'deadline', internalType: 'uint64', type: 'uint64' },
          { name: 'nonce', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'hashIntent',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'intent',
        internalType: 'struct IDeClubIntents.Intent',
        type: 'tuple',
        components: [
          { name: 'maker', internalType: 'address', type: 'address' },
          {
            name: 'give',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'want',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          { name: 'feeToken', internalType: 'address', type: 'address' },
          { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
          { name: 'deadline', internalType: 'uint64', type: 'uint64' },
          { name: 'nonce', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'intentDigest',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'word', internalType: 'uint256', type: 'uint256' },
      { name: 'mask', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'invalidateNonces',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'maker', internalType: 'address', type: 'address' },
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'isNonceUsed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFeeAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingFeeAt',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFee', internalType: 'uint256', type: 'uint256' }],
    name: 'setFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'cycle',
        internalType: 'struct IDeClubIntents.Intent[]',
        type: 'tuple[]',
        components: [
          { name: 'maker', internalType: 'address', type: 'address' },
          {
            name: 'give',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'want',
            internalType: 'struct IDeClubIntents.Asset[]',
            type: 'tuple[]',
            components: [
              {
                name: 'assetType',
                internalType: 'enum IDeClubIntents.AssetType',
                type: 'uint8',
              },
              { name: 'token', internalType: 'address', type: 'address' },
              { name: 'id', internalType: 'uint256', type: 'uint256' },
              { name: 'amount', internalType: 'uint256', type: 'uint256' },
            ],
          },
          { name: 'feeToken', internalType: 'address', type: 'address' },
          { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
          { name: 'deadline', internalType: 'uint64', type: 'uint64' },
          { name: 'nonce', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'signatures', internalType: 'bytes[]', type: 'bytes[]' },
    ],
    name: 'settle',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'next', internalType: 'address', type: 'address' }],
    name: 'transferFeeAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'current',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'FeeAdminTransferStarted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previous',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'FeeAdminTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'effectiveAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeChangeQueued',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeeCharged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'intentHash',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'nonce',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'IntentFilled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'maker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'word',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'mask',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'NoncesInvalidated',
  },
  {
    type: 'error',
    inputs: [{ name: 'size', internalType: 'uint256', type: 'uint256' }],
    name: 'BadCycleSize',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'BadSignature',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'give', internalType: 'bool', type: 'bool' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'DuplicateAsset',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'DuplicateMaker',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'give', internalType: 'bool', type: 'bool' },
    ],
    name: 'EmptySide',
  },
  {
    type: 'error',
    inputs: [{ name: 'effectiveAt', internalType: 'uint256', type: 'uint256' }],
    name: 'FeeRaiseExpired',
  },
  {
    type: 'error',
    inputs: [{ name: 'effectiveAt', internalType: 'uint256', type: 'uint256' }],
    name: 'FeeRaiseNotReady',
  },
  {
    type: 'error',
    inputs: [
      { name: 'fee', internalType: 'uint256', type: 'uint256' },
      { name: 'max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'FeeTooHigh',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'IntentExpired',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'give', internalType: 'bool', type: 'bool' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidAsset',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidDeadline',
  },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'InvalidFeeToken',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidMaker',
  },
  { type: 'error', inputs: [], name: 'InvalidShortString' },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NftNotReceived',
  },
  { type: 'error', inputs: [], name: 'NoFeeRecipient' },
  { type: 'error', inputs: [], name: 'NoPendingFee' },
  {
    type: 'error',
    inputs: [
      { name: 'maker', internalType: 'address', type: 'address' },
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NonceUsed',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotFeeAdmin',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotPendingFeeAdmin',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  {
    type: 'error',
    inputs: [{ name: 'intent', internalType: 'uint256', type: 'uint256' }],
    name: 'SameAssetBothSides',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intents', internalType: 'uint256', type: 'uint256' },
      { name: 'signatures', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SignatureCountMismatch',
  },
  {
    type: 'error',
    inputs: [{ name: 'str', internalType: 'string', type: 'string' }],
    name: 'StringTooLong',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'give', internalType: 'bool', type: 'bool' },
      { name: 'count', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'TooManyAssets',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'give', internalType: 'bool', type: 'bool' },
      { name: 'count', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'TooManyNfts',
  },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'UnsupportedToken',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'wantIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'WantNotMet',
  },
  {
    type: 'error',
    inputs: [
      { name: 'intent', internalType: 'uint256', type: 'uint256' },
      { name: 'feeToken', internalType: 'address', type: 'address' },
      { name: 'maxFee', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'WrongFee',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// DeClubRewards
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const deClubRewardsAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'initialOperator', internalType: 'address', type: 'address' },
      { name: 'claimDelay', internalType: 'uint256', type: 'uint256' },
      { name: 'claimWindow', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'CLAIM_DELAY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'CLAIM_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CLAIM_DELAY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CLAIM_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MIN_CLAIM_WINDOW',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'acceptOperator',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'proof', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'claims',
        internalType: 'struct IDeClubRewards.Claim[]',
        type: 'tuple[]',
        components: [
          { name: 'epoch', internalType: 'uint64', type: 'uint64' },
          { name: 'account', internalType: 'address', type: 'address' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
          { name: 'proof', internalType: 'bytes32[]', type: 'bytes32[]' },
        ],
      },
    ],
    name: 'claimMany',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'epochs',
    outputs: [
      {
        name: '',
        internalType: 'struct IDeClubRewards.Epoch',
        type: 'tuple',
        components: [
          { name: 'root', internalType: 'bytes32', type: 'bytes32' },
          { name: 'total', internalType: 'uint128', type: 'uint128' },
          { name: 'claimed', internalType: 'uint128', type: 'uint128' },
          { name: 'openAt', internalType: 'uint64', type: 'uint64' },
          { name: 'closed', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'isClaimed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'leaf',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'operator',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingOperator',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'root', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'publish',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'revoke',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'sweep',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'next', internalType: 'address', type: 'address' }],
    name: 'transferOperator',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64', indexed: true },
      {
        name: 'root',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'total',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'openAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'EpochPublished',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64', indexed: true },
      {
        name: 'refund',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'EpochRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'EpochSwept',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'current',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'OperatorTransferStarted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previous',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'next', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'OperatorTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64', indexed: true },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RewardClaimed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'AlreadyClaimed',
  },
  {
    type: 'error',
    inputs: [
      { name: 'claimDelay', internalType: 'uint256', type: 'uint256' },
      { name: 'claimWindow', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'BadTiming',
  },
  { type: 'error', inputs: [], name: 'EmptyRoot' },
  {
    type: 'error',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'EpochClosed',
  },
  {
    type: 'error',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'EpochExists',
  },
  {
    type: 'error',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidProof',
  },
  { type: 'error', inputs: [], name: 'NoOperator' },
  {
    type: 'error',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'openAt', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'NotOpenYet',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'NotPendingOperator',
  },
  { type: 'error', inputs: [], name: 'NothingFunded' },
  {
    type: 'error',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'claimed', internalType: 'uint256', type: 'uint256' },
      { name: 'total', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'OverClaim',
  },
  {
    type: 'error',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'PayoutFailed',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'RevokeTooLate',
  },
  {
    type: 'error',
    inputs: [
      { name: 'epoch', internalType: 'uint64', type: 'uint64' },
      { name: 'at', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SweepTooEarly',
  },
  {
    type: 'error',
    inputs: [{ name: 'epoch', internalType: 'uint64', type: 'uint64' }],
    name: 'UnknownEpoch',
  },
  { type: 'error', inputs: [], name: 'ZeroAccount' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MockChog
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const mockChogAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_MINT_PER_TX',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'quantity', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [{ name: 'firstId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextTokenId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'traitsOf',
    outputs: [
      { name: 'hat', internalType: 'string', type: 'string' },
      { name: 'eyes', internalType: 'string', type: 'string' },
      { name: 'background', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'approved',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Transfer',
  },
  { type: 'error', inputs: [], name: 'ERC721EnumerableForbiddenBatchMint' },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC721IncorrectOwner',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721InsufficientApproval',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC721NonexistentToken',
  },
  {
    type: 'error',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721OutOfBoundsIndex',
  },
  {
    type: 'error',
    inputs: [{ name: 'quantity', internalType: 'uint256', type: 'uint256' }],
    name: 'InvalidQuantity',
  },
] as const
