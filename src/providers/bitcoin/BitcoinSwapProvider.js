import Provider from '../../Provider'
import { addressToPubKeyHash } from './BitcoinUtil'

export default class BitcoinSwapProvider extends Provider {
  _padHexStart (hex, length) {
    let len = length || hex.length
    len += len % 2

    return hex.padStart(len, '0')
  }

  generateSwap (recipientAddress, refundAddress, secretHash, expiration) {
    let expirationHex = Buffer.from(this._padHexStart(expiration.toString(16)), 'hex').reverse()

    expirationHex = expirationHex.slice(0, Math.min(expirationHex.length, 5))
    expirationHex.writeUInt8(0, expirationHex.length - 1)

    const recipientPubKeyHash = addressToPubKeyHash(recipientAddress)
    const refundPubKeyHash = addressToPubKeyHash(refundAddress)
    const expirationPushDataOpcode = this._padHexStart(expirationHex.length.toString(16))
    const expirationHexEncoded = expirationHex.toString('hex')

    return [
      '76', 'a9', // OP_DUP OP_HASH160
      '72', // OP_2SWAP
      '63', // OP_IF
      'a8', // OP_SHA256
      '20', secretHash, // OP_PUSHDATA(20) {secretHash}
      '88', // OP_EQUALVERIFY
      '14', recipientPubKeyHash, // OP_PUSHDATA(20) {recipientPubKeyHash}
      '67', // OP_ELSE
      expirationPushDataOpcode, // OP_PUSHDATA({expirationHexLength})
      expirationHexEncoded, // {expirationHexEncoded}
      'b1', // OP_CHECKLOCKTIMEVERIFY
      '6d', // OP_2DROP
      '14', refundPubKeyHash, // OP_PUSHDATA(20) {refundPubKeyHash}
      '68', // OP_ENDIF
      '88', 'ac' // OP_EQUALVERIFY OP_CHECKSIG
    ].join('')
  }

  _spendSwap (signature, pubKey, isRedeem, secret) {
    const redeemEncoded = isRedeem ? '51' : '00' // OP_1 : OP_0
    const encodedSecret = isRedeem
      ? [
        this._padHexStart((secret.length / 2).toString(16)), // OP_PUSHDATA({secretLength})
        secret
      ]
      : ['00'] // OP_0

    const signaturePushDataOpcode = this._padHexStart((signature.length / 2).toString(16))
    const pubKeyPushDataOpcode = this._padHexStart((pubKey.length / 2).toString(16))

    const bytecode = [
      signaturePushDataOpcode,
      signature,
      ...encodedSecret,
      redeemEncoded,
      pubKeyPushDataOpcode,
      pubKey
    ]

    return bytecode.join('')
  }

  redeemSwap (pubKey, signature, secret) {
    return this._spendSwap(signature, pubKey, true, secret)
  }

  refundSwap (pubKey, signature) {
    return this._spendSwap(signature, pubKey, false)
  }
}
