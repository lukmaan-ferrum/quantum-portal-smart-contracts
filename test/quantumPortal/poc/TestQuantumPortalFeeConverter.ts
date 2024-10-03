import hre, { ethers } from "hardhat"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { expect } from "chai";
import { deployAll, deployNativeFeeRepo, deployWFRM, QuantumPortalUtils } from "./QuantumPortalUtils";
import FeeConverterDeployModule from "../../../ignition/modules/test/FeeConverter"

const GWEI = 1_000_000_000n
const ETH_FRM_PRICE = 120_000n
const BNB_FRM_PRICE = 30_000n
const CHAIN1_GAS_PRICE = 5n * GWEI
const CHAIN2_GAS_PRICE = 2n * GWEI

describe("FeeConverter", function () {
    let ctx

    beforeEach("should deploy and config MultiSwap", async () => {
        ctx = await deployAll();
        const chainIds = [ctx.chain1.chainId, ctx.chain2.chainId]
        const chainNativeToFrmPrices = [ETH_FRM_PRICE, BNB_FRM_PRICE]
        const chainGasPrices = [CHAIN1_GAS_PRICE, CHAIN2_GAS_PRICE]

        await ctx.chain1.feeConverter.setChainGasPrices(chainIds, chainNativeToFrmPrices, chainGasPrices)
    })

    it("Get fixed fee", async function () {
        // Fee per byte set to 0.001 FRM in deployAll()
        const feePerByte = ethers.parseEther("0.001")
        const payloadSize = 292n
        expect(await ctx.chain1.feeConverter.fixedFee(payloadSize)).to.be.equal(payloadSize * feePerByte)
    })

    it("Get target chain fee for tx execution", async function () {
        const gasLimit = 200000n
        const gasCostInTargetNative = gasLimit * CHAIN2_GAS_PRICE
        const gasCostInFrm = gasCostInTargetNative * BNB_FRM_PRICE

        expect(await ctx.chain1.feeConverter.targetChainGasFee(ctx.chain2.chainId, gasLimit)).to.be.equal(gasCostInFrm)
    })

    it("Get fixed fee in local chain native asset", async function () {
        const payloadSize = 292n
        const feePerByte = ethers.parseEther("0.001")
        const fixFeeInNative = payloadSize * feePerByte / ETH_FRM_PRICE

        expect(await ctx.chain1.feeConverter.fixedFeeNative(payloadSize)).to.be.equal(fixFeeInNative)
    })

    it("Get target chain fee for tx execution in local chain native asset", async function () {
        const gasLimit = 200000n
        const gasCostInTargetNative = gasLimit * CHAIN2_GAS_PRICE
        const gasCostInFrm = gasCostInTargetNative * BNB_FRM_PRICE
        const gasCostInEth = gasCostInFrm / ETH_FRM_PRICE

        expect(await ctx.chain1.feeConverter.targetChainGasFeeNative(ctx.chain2.chainId, gasLimit)).to.be.equal(gasCostInEth)
    })
})
