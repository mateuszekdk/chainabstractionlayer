import { findKey } from 'lodash'

import { base58, padHexStart } from '@liquality/crypto'
import * as bitcoin from 'bitcoinjs-lib'
import * as classify from 'bitcoinjs-lib/src/classify';
import networks from '@liquality/bitcoin-networks'
import coinselect from 'coinselect'
import coinselectAccumulative from 'coinselect/accumulative'
import { version } from '../package.json'

function calculateFee (numInputs, numOutputs, feePerByte) {
  return ((numInputs * 148) + (numOutputs * 34) + 10) * feePerByte
}

/**
 * Get compressed pubKey from pubKey.
 * @param {!string} pubKey - 65 byte string with prefix, x, y.
 * @return {string} Returns the compressed pubKey of uncompressed pubKey.
 */
function compressPubKey (pubKey) {
  const x = pubKey.substring(2, 66)
  const y = pubKey.substring(66, 130)
  const even = parseInt(y.substring(62, 64), 16) % 2 === 0
  const prefix = even ? '02' : '03'

  return prefix + x
}

/**
 * Get a network object from an address
 * @param {string} address The bitcoin address
 * @return {Network}
 */
function getAddressNetwork (address) {
  // TODO: can this be simplified using just bitcoinjs-lib??
  let networkKey
  // bech32
  networkKey = findKey(networks, network => address.startsWith(network.bech32))
  // base58
  if (!networkKey) {
    const prefix = base58.decode(address).toString('hex').substring(0, 2)
    networkKey = findKey(networks, network => {
      const pubKeyHashPrefix = padHexStart((network.pubKeyHash).toString(16), 2)
      const scriptHashPrefix = padHexStart((network.scriptHash).toString(16), 2)
      return [pubKeyHashPrefix, scriptHashPrefix].includes(prefix)
    })
  }
  return networks[networkKey]
}

function selectCoins (utxos, targets, feePerByte, fixedInputs = []) {
  let selectUtxos = utxos
  let inputs, outputs
  let fee = 0

  // Default coinselect won't accumulate some inputs
  // TODO: does coinselect need to be modified to ABSOLUTELY not skip an input?
  const coinselectStrat = fixedInputs.length ? coinselectAccumulative : coinselect
  if (fixedInputs.length) {
    selectUtxos = [ // Order fixed inputs to the start of the list so they are used
      ...fixedInputs,
      ...utxos.filter(utxo => !fixedInputs.find(input => input.vout === utxo.vout && input.txid === utxo.txid))
    ]
  }

  ({ inputs, outputs, fee } = coinselectStrat(selectUtxos, targets, Math.ceil(feePerByte)))

  return { inputs, outputs, fee }
}

const OUTPUT_TYPES_MAP = {
  [classify.types.P2WPKH]: 'witness_v0_keyhash',
  [classify.types.P2WSH]: 'witness_v0_scripthash'
}

function decodeRawTransaction (hex, network) {
  const bjsTx = bitcoin.Transaction.fromHex(hex)

  const vin = bjsTx.ins.map((input) => {
    return {
        txid: Buffer.from(input.hash).reverse().toString('hex'),
        vout: input.index,
        scriptSig: {
          asm: bitcoin.script.toASM(input.script),
          hex: input.script.toString('hex')
        },
        txinwitness: input.witness.map(w => w.toString('hex')),
        sequence: input.sequence,
    }
  })

  const vout = bjsTx.outs.map((output, n) => {
    const type = classify.output(output.script)

    var vout = {
      value: output.value / 1e8,
      n,
      scriptPubKey: {
        asm: bitcoin.script.toASM(output.script),
        hex: output.script.toString('hex'),
        reqSigs: 1, // TODO: not sure how to derive this
        type: OUTPUT_TYPES_MAP[type] || type,
        addresses: [],
      }
    };

    try {
      const address = bitcoin.address.fromOutputScript(output.script, network)
      vout.scriptPubKey.addresses.push(address)
    } catch (e) {}

    return vout
  })

  return {
    txid: bjsTx.getHash(false).reverse().toString('hex'),
    hash: bjsTx.getHash(true).reverse().toString('hex'),
    version: bjsTx.version,
    locktime: bjsTx.locktime,
    size: bjsTx.byteLength(),
    vsize: bjsTx.virtualSize(),
    weight: bjsTx.weight(),
    vin,
    vout,
    hex
  }
}

const AddressTypes = [
  'legacy', 'p2sh-segwit', 'bech32'
]

export {
  calculateFee,
  compressPubKey,
  getAddressNetwork,
  selectCoins,
  decodeRawTransaction,
  AddressTypes,
  version
}
