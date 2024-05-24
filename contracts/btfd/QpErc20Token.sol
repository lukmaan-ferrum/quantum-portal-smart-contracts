
pragma solidity 0.8.25;


import "./ITokenFactory.sol";
import "./IQuantumPortalPoc.sol";
import "./IWalletRegistration.sol";
import "./IBitcoinIntent.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "./WalletRegistration.sol";
import "./BtcLib.sol";

import "hardhat/console.sol";

error AlreadyInit ();
error NotAllowed ();
error NoBalance ();
error NotRegisteredAsWalletOwner ();
error TxAlreadyProcessed ();

contract QpErc20Token is Initializable, ContextUpgradeable, IBitcoinIntent {
    using SafeERC20 for IERC20;
    struct RemoteCall {
        uint64 targetNetwork;
        address beneficiary;
        address targetContract;
        bytes methodCall;
        uint fee;
    }

    /// @custom:storage-location erc7201:ferrum.storage.QPERC20
    struct QpErc20Storage {
        uint tokenId;
        uint64 version;
        ITokenFactory factory;

        string name;
        string symbol;
        uint8 decimals;
        uint totalSupply;
        mapping(address => uint) btcBalanceOf;
        uint totalSupplyQp;
        mapping (address=>uint) qpBalanceOf;
        mapping(address => mapping(address => uint)) allowance;
        mapping (bytes32 => uint) processedTxs;
    }

    // keccak256(abi.encode(uint256(keccak256("ferrum.storage.QPERC20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant QPERC20StorageLocation = 0x61091cc7eb54cdb834970784b51d6c44e08db297c718cb7f7bd0dc267543c800;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);
    event BtcTransfer(address indexed from, address indexed to, uint value);
    event QpTransfer(address indexed from, address indexed to, uint value);
    event TransactionProcessed(address indexed miner, uint blocknumber, bytes32 txid, uint timestamp);
    event RemoteCallProcessed(address indexed beneficiary, RemoteCall remoteCall, uint amount);
    event RemoteCallProcessFailed(address indexed beneficiary, RemoteCall remoteCall, uint amount);
    event SettlementInitiated(address indexed sender, string btcAddress, uint amount, uint btcFee);

    function _getQPERC20Storage() internal pure returns (QpErc20Storage storage $) {
        assembly {
            $.slot := QPERC20StorageLocation
        }
    }

    constructor(
    ) {
        _disableInitializers();
    }

    function tokenId() external view returns (uint) {
        return _getQPERC20Storage().tokenId;
    }

    function version() external view returns (uint64) {
        return _getQPERC20Storage().version;
    }

    function factory() external view returns (ITokenFactory) {
        return _getQPERC20Storage().factory;
    }

    function name() external virtual view returns (string memory) {
        return _getQPERC20Storage().name;
    }

    function symbol() external virtual view returns (string memory) {
        return _getQPERC20Storage().symbol;
    }

    function decimals() external view returns (uint8) {
        return _getQPERC20Storage().decimals;
    }

    function totalSupply() external view returns (uint) {
        return _getQPERC20Storage().totalSupply;
    }

    function totalSupplyQp() external view returns (uint) {
        return _getQPERC20Storage().totalSupplyQp;
    }

    function allowance(address owner, address spender) external view returns (uint) {
        return _getQPERC20Storage().allowance[owner][spender];
    }

    function processedTxs(bytes32 txid) external view returns (uint) {
        return _getQPERC20Storage().processedTxs[txid];
    }

    function initialize(
        uint _tokenId,
        uint64 _version,
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint _totalSupply,
        bytes32 /*deployTxId*/
    ) external initializer {
        // TODO: Use pre-compile interfaces to verify metadata from the deployTxId
        __QPERC20_init(_tokenId, _version, _name, _symbol, _decimals, _totalSupply);
        __Context_init();
    }

    function __QPERC20_init(
        uint _tokenId,
        uint64 _version,
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint _totalSupply
    ) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.name = _name;
        $.symbol = _symbol;
        $.decimals = _decimals;
        $.totalSupply = _totalSupply;
        $.tokenId = _tokenId;
        $.version = _version;
        $.factory = ITokenFactory(msg.sender);
    }


    /**
     * @notice Returns the total balance of an address
     */
    function balanceOf(address addr) external view returns (uint) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        return $.btcBalanceOf[addr] + $.qpBalanceOf[addr];
    }

    /**
     * @notice Returns the total balance of an address given the BTC address
     */
    function balanceOfBtc(string calldata _btcAddress) external view returns (uint) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        address addr = BtcLib.parseBtcAddress(_btcAddress);
        return $.btcBalanceOf[addr] + $.qpBalanceOf[addr];
    }

    /**
     * @notice Returns the settled balance of an address as it is on the Bicoin blockchain
     */
    function settledBalanceOf(address addr) external view returns (uint) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        return $.btcBalanceOf[addr];
    }

    /**
     * @notice Returns the settled balance of an address as it is on the Bicoin blockchain
     * given the BTC address
     */
    function settledBalanceOfBtc(string calldata _btcAddress) external view returns (uint) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        address addr = BtcLib.parseBtcAddress(_btcAddress);
        return $.btcBalanceOf[addr];
    }

    /**
     * @notice Returns the equivalen EVM address for the given BTC address
     */
    function btcAddress(string calldata _btcAddress) external view returns (address) {
        return BtcLib.parseBtcAddress(_btcAddress);
    }

    /**
     * @notice This will settle the BTC using QP.
     */
    function settle(string calldata _btcAddress, uint256 btcFee) public {
        QpErc20Storage storage $ = _getQPERC20Storage();
        // Withdraw the qpBalance for the user
        address addr = BtcLib.parseBtcAddress(_btcAddress);
        uint amount = $.qpBalanceOf[addr];
        if (amount == 0) revert NoBalance();
        _burnQp(addr, amount);

        IERC20($.factory.btc()).transferFrom(_msgSender(), IQuantumPortalPoc($.factory.portal()).feeTarget(), btcFee);
        BtcLib.initiateWithdrawal(_btcAddress, $.tokenId, $.version, btcFee);
        emit SettlementInitiated(addr, _btcAddress, amount, btcFee);
    }

    /**
     * @notice This will settle the BTC using QP to a given BTC address.
     */
    function settleTo(string calldata _btcAddress, uint256 amount, uint256 btcFee) external virtual {
        QpErc20Storage storage $ = _getQPERC20Storage();
        address msgSender = _msgSender();
        _burnQp(msgSender, amount);
        IERC20($.factory.btc()).transferFrom(msgSender, IQuantumPortalPoc($.factory.portal()).feeTarget(), btcFee);
        BtcLib.initiateWithdrawal(_btcAddress, $.tokenId, $.version, btcFee);
        emit SettlementInitiated(msgSender, _btcAddress, amount, btcFee);
    }

    function approve(address spender, uint value) external returns (bool) {
        _approveQp(msg.sender, spender, value);
        return true;
    }

    /**
     * @notice This will transfer the QpBalance
     */
    function transfer(address to, uint value) external returns (bool) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        if (msg.sender == $.factory.portal()) {
            console.log("MINTING");
            _mintQp(to, value);
        } else {
            console.log("TXING");
            _transferQp(msg.sender, to, value);
        }
        return true;
    }

    /**
     * @notice This method can be called as the intent to directly transfer BTC level
     * assets to EVM level assets.
     * For example by calling this remoteTransfer, the following will happen:
     * Alice registers (remoteTrasnfer, with Bob as beneficiary), then send 1 BTC to QP
     * QP will add that BTC to balance of the BTC contract, and call this method
     * we will mint 1 QP_BTC to Bob
     */
    function remoteTransfer() external override {
        QpErc20Storage storage $ = _getQPERC20Storage();
        console.log("REMOTE TRANSFER CALLED");
        address portal = $.factory.portal();
        (uint netId, address sourceMsgSender, address beneficiary) = IQuantumPortalPoc(portal)
            .msgSender();
        console.log("NET", netId);
        console.log("BENEF", beneficiary);
        console.log("SOURCE", sourceMsgSender);
        console.log("CHAIN", block.chainid);
        if (netId != block.chainid) revert NotAllowed();
        if (sourceMsgSender != address(this)) revert NotAllowed();
        QuantumPortalLib.RemoteTransaction memory _tx = IQuantumPortalPoc(portal)
            .txContext()
            .transaction;
        console.log("AMOUNT", _tx.amount);
        // We need to transfer our balance to beneficiary, then withdraw for her
        IQuantumPortalPoc(portal).localTransfer(address(this), beneficiary, _tx.amount);
    }

    function whatIs() external pure returns (bytes memory res) {
        res = abi.encodeWithSelector(QpErc20Token.remoteTransfer.selector);
    }

    function transferFrom(address from, address to, uint value) external returns (bool) {
        QpErc20Storage storage $ = _getQPERC20Storage();
        if ($.allowance[from][msg.sender] != type(uint).max) {
            $.allowance[from][msg.sender] -= value;
        }
        _transferQp(from, to, value);
        return true;
    }

    // /**
    //  * @notice Only one remoteCall at a time
    //  */
    // function registerRemoteCall(
    //     uint64 targetNetwork,
    //     address targetContract,
    //     address beneficiary,
    //     bytes memory methodCall,
    //     uint fee
    // ) internal {
    //     QpErc20Storage storage $ = _getQPERC20Storage();
    //     // 1. Transfer fee
    //     // 2. Register the intent
    //     address portal = $.factory.portal();
    //     IERC20(IQuantumPortalPoc(portal).feeToken()).safeTransferFrom(_msgSender(), address(this), fee);
    //     $.remoteCalls[beneficiary] = RemoteCall ({
    //         targetNetwork: targetNetwork,
    //         targetContract: targetContract,
    //         beneficiary: beneficiary,
    //         methodCall: methodCall,
    //         fee: fee
    //     });
    // }

    /**
     * @notice Processes the transaction. We encode the tx in a custome format to save space.
     */
    // function processTx(bytes32 txid) external {
    //     QpErc20Storage storage $ = _getQPERC20Storage();
    //     if ($.processedTxs[txid] != 0) revert TxAlreadyProcessed();
    //     $.processedTxs[txid] = 1;
    //     (uint64 block,
    //     uint64 timestamp,
    //     BtcLib.TransferItem[] memory inputs,
    //     BtcLib.TransferItem[] memory outputs,
    //     bytes memory encodedCall) =  // includes targetNetwork, beneficiary, targetContract, methodCall, fee
    //         BtcLib.processTx($.tokenId, $.version, txid);

    //     Intent memory qpCall;
    //     if (encodedCall.length != 0) {
    //         qpCall = parseIntent(encodedCall);
    //     }

    //     if (froms.length == 0) {
    //         for (uint i = 0; i < tos.length; i++) {
    //             // this is a mint
    //             _mintBtc(tos[i], values[i]);
    //         }
    //     } else {
    //         uint sum_inputs;
    //         for (uint i = 0; i < inputs.length; i++) {
    //             // this is a transfer to the contract
    //             _transferBtc(inputs[i].addr, address(this), inputs[i].value);
    //             sum_inputs += inputs[i];
    //         }

    //         address qpWallet = $.factory.qpWallet();
    //         uint sum_outputs;
    //         for (uint i = 0; i < outputs.length; i++) {
    //             // this is a transfer to the recipient
    //             if (tos[i] == qpWallet) {
    //                 if (outputs[i].value >= qpCall.fee) {
    //                     _transferBtc(address(this), outputs[i].addr, qpCall.fee);
    //                     _transferBtc(address(this), qpWallet, outputs[i].value - qpCall.fee);
    //                     processIntent(froms, values[i]);
    //                 }
    //             } else {
    //                 _transferBtc(address(this), outputs[i].addr, outputs[i].value);
    //             }
    //             sum_outputs += outputs[i].value;
    //         }
    //         // burn consumed fee
    //         uint fee = sum_inputs - sum_outputs;
    //         _burnBtc(address(this), fee);
    //     }
    // }

    // function registerEncodedCall(bytes calldata call) internal {
    //     (uint64 targetNetwork,
    //     address beneficiary,
    //     address targetContract,
    //     bytes memory methodCall,
    //     uint fee) = abi.decode(call, (uint64, address, address, bytes, uint));
    //     registerRemoteCall(beneficiary, targetNetwork, targetContract, beneficiary, methodCall, fee);
    // }

    // called for every transaction
    // TODO: Make it such that the data can be verified from the base layer.
    // so that we won't need to worry about the security
    function multiTransfer(
        address[] calldata froms,
        uint[] calldata inputs,
        address[] calldata tos,
        uint[] calldata values,
        uint blocknumber,
        bytes32 txid,
        uint timestamp,
        bytes memory remoteCall) public {
        QpErc20Storage storage $ = _getQPERC20Storage();
        if ($.processedTxs[txid] != 0) revert TxAlreadyProcessed();
        
        if (froms.length == 0) {
            for (uint i = 0; i < tos.length; i++) {
                // this is a mint
                _mintBtc(tos[i], values[i]);
            }
        } else {
            uint sum_inputs;
            for (uint i = 0; i < froms.length; i++) {
                // this is a transfer to the contract
                _transferBtc(froms[i], address(this), inputs[i]);
                sum_inputs += inputs[i];
            }
            processMultiTransferOutputs(tos, values, sum_inputs, remoteCall);
        }

        address miner = msg.sender;
        $.processedTxs[txid] = blocknumber;
        emit TransactionProcessed(miner, blocknumber, txid, timestamp);
    }

    function processMultiTransferOutputs(
        address[] calldata tos,
        uint[] calldata values,
        uint sumInputs,
        bytes memory remoteCall
    ) private {
        QpErc20Storage storage $ = _getQPERC20Storage();
        address qpWallet = $.factory.qpWallet();
        uint sumOutputs;
        uint sumQpOutputs;
        for (uint i = 0; i < tos.length; i++) {
            // this is a transfer to the recipient
            _transferBtc(address(this), tos[i], values[i]);
            sumOutputs += values[i];

            if (tos[i] == qpWallet) {
                sumQpOutputs += values[i];
            }
        }
        // burn consumed fee
        uint fee = sumInputs - sumOutputs;
        _burnBtc(address(this), fee);
        if (sumQpOutputs > 0) {
            processRemoteCall(remoteCall, sumQpOutputs);
        }
    }

    function processRemoteCall(bytes memory remoteCall, uint amount) internal {
        if (remoteCall.length == 0) { return; }
        QpErc20Storage storage $ = _getQPERC20Storage();

        RemoteCall memory rc;
        (uint64 targetNetwork,
        address beneficiary,
        address targetContract,
        bytes memory methodCall,
        uint fee) = abi.decode(remoteCall, (uint64, address, address, bytes, uint));
        address portal = $.factory.portal();
        address feeToken = IQuantumPortalPoc(portal).feeToken();
        // TODO: We assume fees are already collected. This needs to be verified separately
        IERC20(feeToken).safeTransfer(IQuantumPortalPoc(portal).feeTarget(), fee);
        rc = RemoteCall({
            targetNetwork: targetNetwork,
            beneficiary: beneficiary,
            targetContract: targetContract,
            methodCall: methodCall,
            fee: fee
        });
        try IQuantumPortalPoc(portal).runFromToken(
            targetNetwork,
            targetContract,
            beneficiary,
            methodCall,
            amount
        ) {
            emit RemoteCallProcessed(msg.sender, rc, amount);
        } catch {
            emit RemoteCallProcessFailed(msg.sender, rc, amount);
        }
    }

    function _mintQp(address to, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.totalSupplyQp += value;
        $.qpBalanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit QpTransfer(address(0), to, value);
    }

    function _burnQp(address from, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.qpBalanceOf[from] -= value;
        $.totalSupplyQp  -= value;
        emit Transfer(from, address(0), value);
        emit QpTransfer(from, address(0), value);
    }

    function _transferQp(address from, address to, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.qpBalanceOf[from] -= value;
        $.qpBalanceOf[to] += value;
        emit Transfer(from, to, value);
        emit QpTransfer(from, to, value);
    }

    function _approveQp(address owner, address spender, uint value) private {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _mintBtc(address to, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.totalSupply += value;
        $.btcBalanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit BtcTransfer(address(0), to, value);
    }

    function _burnBtc(address from, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.btcBalanceOf[from] -= value;
        $.totalSupply  -=value;
        emit Transfer(from, address(0), value);
        emit BtcTransfer(from, address(0), value);
    }

    function _transferBtc(address from, address to, uint value) internal {
        QpErc20Storage storage $ = _getQPERC20Storage();
        $.btcBalanceOf[from] -= value;
        $.btcBalanceOf[to] += value;
        emit Transfer(from, to, value);
        emit BtcTransfer(from, to, value);
    }
}