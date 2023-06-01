import { expiryInFuture, seed0x as salt0x, throws, Wei, ZeroAddress } from 
    'foundry-contracts/dist/test/common/Utils';
import { expect } from "chai";
import { advanceTimeAndBlock } from "../../common/TimeTravel";
import { deployAll, PortalContext, QuantumPortalUtils } from "./QuantumPortalUtils";

const _it = (a: any, b: any) => () => {};

function blockMetadata(m: any): { chainId: number,  nonce: number, timestamp: number } {
    return {
        chainId: m.chainId.toNumber(),
        nonce: m.nonce.toNumber(),
        timestamp: m.timestamp.toNumber(),
    }
}

async function mineAndFinilizeOneToTwo(ctx: PortalContext, nonce: number) {
    let key = (await ctx.chain1.ledgerMgr.getBlockIdx(ctx.chain2.chainId, nonce)).toString();
    let tx = await ctx.chain1.ledgerMgr.localBlockTransactions(key, nonce - 1); 
    await QuantumPortalUtils.stakeAndDelegate(ctx.chain1.stake, '10', ctx.owner, ctx.wallets[0], ctx.signers.owner);
    const txs = [{
                token: tx.token.toString(),
                amount: tx.amount.toString(),
                gas: tx.gas.toString(),
                fixedFee: tx.fixedFee.toString(),
                method: tx.method.toString(),
                remoteContract: tx.remoteContract.toString(),
                sourceBeneficiary: tx.sourceBeneficiary.toString(),
                sourceMsgSender: tx.sourceMsgSender.toString(),
                timestamp: tx.timestamp.toString(),
        }];
    const [salt, expiry, signature] = await QuantumPortalUtils.generateSignatureForMining(
        ctx.chain2.ledgerMgr,
        ctx.chain1.chainId.toString(),
        nonce.toString(),
        txs,
        ctx.sks[0], // Miner...
    );
    await ctx.chain2.ledgerMgr.mineRemoteBlock(
        ctx.chain1.chainId,
        nonce.toString(),
        txs,
        salt,
        expiry,
        signature,
    );
    console.log('Now finalizing on chain2');
    await QuantumPortalUtils.finalize(
        ctx.chain1.chainId,
        ctx.chain2.ledgerMgr,
        ctx.sks[0],
    );
}

async function mineAndFinilizeTwoToOne(ctx: PortalContext, nonce: number) {
    let key = (await ctx.chain2.ledgerMgr.getBlockIdx(ctx.chain1.chainId, nonce)).toString();
    let tx = await ctx.chain2.ledgerMgr.localBlockTransactions(key, nonce - 1); 
    // Commenting out because stake contract is shared in this test
    await ctx.chain1.token.transfer(ctx.acc1, Wei.from('10'));
    await QuantumPortalUtils.stakeAndDelegate(ctx.chain2.stake, '10', ctx.acc1, ctx.wallets[1], ctx.signers.acc1);
    const txs = [{
                token: tx.token.toString(),
                amount: tx.amount.toString(),
                gas: tx.gas.toString(),
                fixedFee: tx.fixedFee.toString(),
                method: tx.method.toString(),
                remoteContract: tx.remoteContract.toString(),
                sourceBeneficiary: tx.sourceBeneficiary.toString(),
                sourceMsgSender: tx.sourceMsgSender.toString(),
                timestamp: tx.timestamp.toString(),
        }];
    const [salt, expiry, signature] = await QuantumPortalUtils.generateSignatureForMining(
        ctx.chain1.ledgerMgr,
        ctx.chain2.chainId.toString(),
        nonce.toString(),
        txs,
        ctx.sks[1], // Miner...
    );
    await ctx.chain1.ledgerMgr.mineRemoteBlock(
        ctx.chain2.chainId,
        nonce.toString(),
        txs,
        salt,
        expiry,
        signature,
    );
    console.log('Now finalizing on chain1');
    await QuantumPortalUtils.finalize(
        ctx.chain2.chainId,
        ctx.chain1.ledgerMgr,
        ctx.sks[0],
    );
}

describe("Test qp", function () {
	it('Create an x-chain tx, mine and finalize!', async function() {
        const ctx = await deployAll();
        await ctx.chain1.token.transfer(ctx.chain1.poc.address, Wei.from('20'));
        console.log(`Calling run without fee. this should fail!`);
        await throws(ctx.chain1.poc.runWithValue(
            ctx.chain2.chainId,
            ctx.acc1,
            ZeroAddress,
            ctx.chain1.token.address,
            '0x'), 'QPWPS: Not enough fee');

        const feeTarget = await ctx.chain1.poc.feeTarget();
        let feeAmount = await ctx.chain1.feeConverter.targetChainFixedFee(ctx.chain2.chainId, QuantumPortalUtils.FIXED_FEE_SIZE + 0 /* No method call*/)
        feeAmount = feeAmount.add(Wei.from('0.00001')); // plus some var fee
        await ctx.chain1.token.transfer(feeTarget, feeAmount);
        console.log(`Sent fee to ${feeTarget} - Worth ${feeAmount}. Now we can register the tx`);
        await ctx.chain1.poc.runWithValue(
            ctx.chain2.chainId,
            ctx.acc1,
            ZeroAddress,
            ctx.chain1.token.address,
            '0x')
        // Check the block
        let lastLocalBlock = await ctx.chain1.ledgerMgr.lastLocalBlock(ctx.chain2.chainId);
        expect(lastLocalBlock.nonce).to.be.equal(1, 'Unexpected nonce!');

        console.log('Is the fee collected?');
        let collectedFixedFee = await ctx.chain1.minerMgr.collectedFixedFee(ctx.chain2.chainId);
        let collectedVarFee = await ctx.chain1.minerMgr.collectedVarFee(ctx.chain2.chainId);
        console.log(`Fee collected: Fixed: ${collectedFixedFee} - Var: ${collectedVarFee}`);
        expect(collectedFixedFee.toString()).to.be.equal('288000000000000000');
        expect(collectedVarFee.toString()).to.be.equal('10000000000000');

        let isBlockReady = await ctx.chain1.ledgerMgr.isLocalBlockReady(ctx.chain2.chainId);
        console.log('Is block ready on chain 1? ', isBlockReady);
        expect(isBlockReady).to.be.false;
        let lastNonce = await ctx.chain1.ledgerMgr.lastLocalBlock(ctx.chain2.chainId);
        console.log('Last nonce is ', lastNonce.nonce);
        let block = (await ctx.chain1.ledgerMgr.localBlockByNonce(ctx.chain2.chainId, 1))[0];
        console.log('Local block is: ', blockMetadata(block.metadata));
        let key = (await ctx.chain1.ledgerMgr.getBlockIdx(ctx.chain2.chainId, 1)).toString();
        console.log('Key is', ctx.chain2.chainId, ',', key);
        let tx = await ctx.chain1.ledgerMgr.localBlockTransactions(key, 0);
        console.log('Local block txs.0', tx);

        console.log('Moving time forward');
        await advanceTimeAndBlock(120); // Two minutes
        isBlockReady = await ctx.chain1.ledgerMgr.isLocalBlockReady(ctx.chain2.chainId);
        console.log('Is block ready on chain 1? ', isBlockReady);
        expect(isBlockReady).to.be.true;

        console.log('Now, mining a block on chain 2');
        await QuantumPortalUtils.stakeAndDelegate(ctx.chain1.stake, '10', ctx.owner, ctx.wallets[0], ctx.signers.owner);
        const txs = [{
                    token: tx.token.toString(),
                    amount: tx.amount.toString(),
                    gas: tx.gas.toString(),
                    fixedFee: tx.fixedFee.toString(),
                    method: tx.method.toString(),
                    remoteContract: tx.remoteContract.toString(),
                    sourceBeneficiary: tx.sourceBeneficiary.toString(),
                    sourceMsgSender: tx.sourceMsgSender.toString(),
                    timestamp: tx.timestamp.toString(),
            }];
        const [salt, expiry, signature] = await QuantumPortalUtils.generateSignatureForMining(
            ctx.chain2.ledgerMgr,
            ctx.chain1.chainId.toString(),
            '1',
            txs,
            ctx.sks[0], // Miner...
        );
        await ctx.chain2.ledgerMgr.mineRemoteBlock(
            ctx.chain1.chainId,
            '1',
            txs,
            salt,
            expiry,
            signature,
        );
        console.log('Mined');
        let minedBlock = await ctx.chain2.ledgerMgr.minedBlockByNonce(ctx.chain1.chainId, 1);
        console.log('Mined block is ', JSON.stringify(minedBlock, undefined, 2));

        console.log('Now checking the work done');
        let workDone = await ctx.chain2.minerMgr.totalWork(ctx.chain1.chainId);
        let myWork = await ctx.chain2.minerMgr.works(ctx.chain1.chainId, ctx.wallets[0]);
        console.log(`Toral work is ${workDone} - vs mine: ${myWork} - ${ctx.wallets[0]}`);
        expect(workDone.toString()).to.be.equal('288');
        expect(myWork.toString()).to.be.equal('288');

        console.log('Now finalizing on chain2');
        await QuantumPortalUtils.finalize(
            ctx.chain1.chainId,
            ctx.chain2.ledgerMgr,
            ctx.sks[0],
        );

        console.log('Now checking the work done - after finalization');
        workDone = await ctx.chain2.minerMgr.totalWork(ctx.chain1.chainId);
        myWork = await ctx.chain2.minerMgr.works(ctx.chain1.chainId, ctx.owner);
        console.log(`Toral work is ${workDone} - vs mine: ${myWork} - ${ctx.owner}`); // Finalizer work is registered to the owner
        expect(workDone.toString()).to.be.equal('576');
        expect(myWork.toString()).to.be.equal('288');

        console.log('Checking the variable work done registered by authority mgr');
        workDone = await ctx.chain2.autorityMgr.totalWork(ctx.chain1.chainId);
        myWork = await ctx.chain2.autorityMgr.works(ctx.chain1.chainId, ctx.owner);
        console.log(`Work done by authority is ${workDone} - vs mine: ${myWork} - ${ctx.owner}`); // Finalizer work is registered to the owner
        expect(workDone.toString()).to.be.equal('26435');
        expect(myWork.toString()).to.be.equal('26435');

        // await ctx.chain2.ledgerMgr.finalize(ctx.chain1.chainId, 1, Salt, [], salt0x(), expiryInFuture(), '0x');
        // let remoteBalance = Wei.to((await ctx.chain2.poc.remoteBalanceOf(ctx.chain1.chainId, ctx.chain1.token.address, ctx.acc1)).toString());
        let remoteBalance = Wei.to((await ctx.chain2.poc.remoteBalanceOf(ctx.chain1.chainId, ctx.chain1.token.address, tx.remoteContract.toString())).toString());
        console.log('Remote balance for acc1, token1 is', remoteBalance.toString());
        expect(remoteBalance).to.be.equal('20.0');
    });

    it('Miners can claim their rewards.', async function() {
        // Run some txs to collect rewards.
        const ctx = await deployAll();
        await ctx.chain1.token.transfer(ctx.chain1.poc.address, Wei.from('20'));
        const feeTarget = await ctx.chain1.poc.feeTarget();
        let feeAmount = await ctx.chain1.feeConverter.targetChainFixedFee(ctx.chain2.chainId, QuantumPortalUtils.FIXED_FEE_SIZE + 0 /* No method call*/)
        feeAmount = feeAmount.add(Wei.from('0.00001')); // plus some var fee
        await ctx.chain1.token.transfer(feeTarget, feeAmount);
        await ctx.chain1.poc.runWithValue(
            ctx.chain2.chainId,
            ctx.acc1,
            ZeroAddress,
            ctx.chain1.token.address,
            '0x');
        await mineAndFinilizeOneToTwo(ctx, 1);
        console.log('Mined and finalized');
        console.log("Now lets check our miner's balance");
        feeAmount = await ctx.chain2.feeConverter.targetChainFixedFee(ctx.chain1.chainId, QuantumPortalUtils.FIXED_FEE_SIZE + 300 /* withdraw call estimate */);
        await ctx.chain2.token.approve(ctx.chain2.minerMgr.address, feeAmount);
        await ctx.chain2.minerMgr.withdraw(ctx.chain1.chainId, ctx.wallets[0], feeAmount);
        console.log('Called withdraw. Now we need to mine and finalize');
        console.log(`Current balance is: ${(await ctx.chain2.token.balanceOf(ctx.acc1)).toString()}`);
        await mineAndFinilizeTwoToOne(ctx, 1);
        console.log('Ensure some balance is updated');
        const finalBal = Wei.to((await ctx.chain2.token.balanceOf(ctx.wallets[0])).toString());
        console.log(`POST - Current balance is: ${finalBal}`);
        expect(finalBal).to.be.equal('0.144');
    });
});