import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { throws, Wei, ZeroAddress } from 'foundry-contracts/dist/test/common/Utils';
import deployModule from "../../../ignition/modules/TestContext";
import { Contract, randomBytes, Signer, TypedDataEncoder } from "ethers";

describe("Proxy version", function () {
    let gateway,
        ledgerMgr,
        poc,
        authMgr,
        feeConverterDirect,
        staking,
        minerMgr,
        owner,
        signer1,
        signer2,
        signer3,
        signer4,
        signer5,
        signer6,
        signer7,
        dev,
        settings
    
    async function deploymentFixture() {
        [owner, signer1, signer2, signer3, signer4, signer5, signer6, signer7, dev] = await hre.ethers.getSigners();
        
        ({ gateway, ledgerMgr, poc, authMgr, feeConverterDirect, staking, minerMgr } = await hre.ignition.deploy(deployModule))
    }

    beforeEach(async function () {
        await loadFixture(deploymentFixture);
        await gateway.addDevAccounts([owner])
        settings  = [{
            quorumId: await gateway.BETA_QUORUMID(),
            target: poc.target,
            funcSelector: poc.interface.getFunction("setFeeToken", ["address"]).selector,
        },
        {
            quorumId: await gateway.PROD_QUORUMID(),
            target: ledgerMgr.target,
            funcSelector: ledgerMgr.interface.getFunction("updateLedger", ["address"]).selector,
        },
        {
            quorumId: await gateway.TIMELOCKED_PROD_QUORUMID(),
            target: ledgerMgr.target,
            funcSelector: ledgerMgr.interface.getFunction("updateMinerMgr", ["address"]).selector,
        }]
    });

    it("Should have the correct version", async function () {
        console.log(await gateway.NAME())
        expect(await gateway.VERSION()).to.equal("000.010");
    });

    it("Should allow devs to initially set auth levels for each call correctly", async function () {
        await gateway.setCallAuthLevels(settings)
        
        expect(await gateway.minRequiredAuth(settings[0].target, settings[0].funcSelector)).to.equal(settings[0].quorumId);
        expect(await gateway.minRequiredAuth(settings[1].target, settings[1].funcSelector)).to.equal(settings[1].quorumId);
        expect(await gateway.minRequiredAuth(settings[2].target, settings[2].funcSelector)).to.equal(settings[2].quorumId);
    })

    it("Should not allow devs to change auth levels once set", async function () {
        await gateway.setCallAuthLevels(settings)
        const tx = gateway.setCallAuthLevels(settings)
        await expect(tx).to.be.revertedWith("FA: already set")
    })

    it("Quorum should be able to permit a call", async function () {
        await gateway.setCallAuthLevels(settings)
        const salt = "0x" + Buffer.from(randomBytes(32)).toString("hex")
        const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 1 // 1 day

        const data = "0x12345678" // Arbitrary data

        // BETA_QUORUMID
        // Members: owner, signer1
        const multisig = await getMultisig(
            poc,
            gateway,
            data,
            await gateway.BETA_QUORUMID(),
            salt,
            expiry,    
            [owner, signer1]
        )

        await gateway.permitCall(poc, data, await gateway.BETA_QUORUMID(), salt, expiry, multisig.sig)

        expect((await gateway.permittedCalls(multisig.structHash))[0]).to.be.true
    })

    it("devs should not be able to make a call without permission", async function () {
        await gateway.setCallAuthLevels(settings)
        await gateway.addDevAccounts([dev])
        const salt = "0x" + Buffer.from(randomBytes(32)).toString("hex")
        const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 1 // 1 day

        const funcName = "setFeeToken"
        const newFeeToken = await hre.ethers.deployContract("TestToken")
        const params = [newFeeToken.target]
        const calldata = poc.interface.encodeFunctionData(funcName, params)

        const tx = gateway.connect(dev).executePermittedCall(poc, calldata, await gateway.BETA_QUORUMID(), salt, expiry)

        await expect(tx).to.be.revertedWith("FA: not permitted")
    })

    it("Dev should be able to make a permitted call", async function () {
        await gateway.setCallAuthLevels(settings)
        await gateway.addDevAccounts([dev])
        await poc.transferOwnership(gateway)
        const salt = "0x" + Buffer.from(randomBytes(32)).toString("hex")
        const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 1 // 1 day

        const funcName = "setFeeToken"
        const newFeeToken = await hre.ethers.deployContract("TestToken")
        const params = [newFeeToken.target]
        const calldata = poc.interface.encodeFunctionData(funcName, params)

        const multisig = await getMultisig(
            poc,
            gateway,
            calldata,
            await gateway.BETA_QUORUMID(),
            salt,
            expiry,    
            [owner, signer1]
        )

        await gateway.permitCall(poc, calldata, await gateway.BETA_QUORUMID(), salt, expiry, multisig.sig)

        const tx = gateway.connect(dev).executePermittedCall(poc, calldata, await gateway.BETA_QUORUMID(), salt, expiry)
        await expect(tx).to.emit(gateway, "CallExecuted").withArgs(multisig.structHash, poc.target, calldata)
        expect(await poc.feeToken()).to.equal(newFeeToken.target)
    })
});

interface Sig {
    addr: string,
    sig: string
}

const getMultisig = async (
    targetContract:Contract,
    verifyingContract:Contract,
    data:string,
    quorumId:string,
    salt:string,
    expiry:number,
    signers: Signer[]    
) => {    
    const domain = {
        name: "FERRUM_QUANTUM_PORTAL_GATEWAY",
        version: "000.010",
        chainId: 31337,
        verifyingContract: verifyingContract.target as string
    };

    const types = {
        PermitCall: [
            { name: "target", type: "address" },
            { name: "data", type: "bytes" },
            { name: "quorumId", type: "address" },
            { name: "salt", type: "bytes32" },
            { name: "expiry", type: "uint256" }
        ],
    };

    const values = {
        target: targetContract.target,
        data,
        quorumId,
        salt,
        expiry
    };

    const typedDataEncoder = new TypedDataEncoder(types)
    const typedData = typedDataEncoder.hashStruct("PermitCall", values)

    const sigs: Sig[] = [];
    
    for (const signer of signers) {
        const signature = await signer.signTypedData(domain, types, values);
        sigs.push({
            addr: await signer.getAddress(),
            sig: signature
        });
    }
    
    return {
        sig: sigsToMultisig(sigs),
        structHash: typedData
    };
}

const sigsToMultisig = (sigs: Sig[]): string => {
    let sig: string = '';
    let vs: string = '';

    // Sort the signatures based on the signer's address in descending order
    sigs.sort((s1, s2) => Buffer.from(s1.addr.replace('0x', ''), 'hex').compare(Buffer.from(s2.addr.replace('0x', ''), 'hex')));

    for (let i = 0; i < sigs.length; i++) {
        const sigWithoutPrefix = sigs[i].sig.replace('0x', '');

        const r = sigWithoutPrefix.slice(0, 64);
        const s = sigWithoutPrefix.slice(64, 128);
        const v = sigWithoutPrefix.slice(128, 130);

        sig += `${r}${s}`;

        vs += v;
    }

    // Pad the vs values to make their length a multiple of 64
    const padding = (vs.length % 64) === 0 ? 0 : 64 - (vs.length % 64);
    vs = vs + '0'.repeat(padding);

    sig = sig + vs;

    return '0x' + sig;
};